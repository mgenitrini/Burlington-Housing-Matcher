// Variable to hold the loaded JSON data
let HOUSING_DATA = [];
// Global variables to store the last results for CSV download
let LAST_ANSWERS = null;
let LAST_MATCHES = [];

// Helper function to get the value of a selected radio button group
function getRadioValue(name) {
    const selector = `input[name="${name}"]:checked`;
    const element = document.querySelector(selector);
    return element ? element.value : null;
}

// --- BRANCHING LOGIC ---

// This function is called by the 'onclick' event in index.html
function showBranchingSections() {
    const status = getRadioValue('current_housing'); 
    
    // Hide all sections first
    document.getElementById('unhoused-section').style.display = 'none';
    document.getElementById('at-risk-section').style.display = 'none';
    document.getElementById('family-section').style.display = 'none';
    
    // Show the relevant section
    if (status === "Currently unhoused") {
        document.getElementById('unhoused-section').style.display = 'block';
    } else if (status === "At risk of losing housing") {
        document.getElementById('at-risk-section').style.display = 'block';
    } else if (status === "Staying with friends or family") {
        document.getElementById('family-section').style.display = 'block';
    }
}

// Fetch and load the data when the script starts
fetch('housing_data.json')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        HOUSING_DATA = data;
        // Attach the event listener to the form AFTER the data has loaded
        document.getElementById('housing-survey').addEventListener('submit', runSurvey);
        // Initial call to hide sections on page load
        showBranchingSections(); 
    })
    .catch(error => {
        console.error("Could not load housing data:", error);
        document.getElementById('results-container').innerHTML = 
            `<h2>Error: Could not load housing data. Check if 'housing_data.json' is in the same folder.</h2>`;
    });

// -----------------------------------------------------
// --- SCORING, MATCHING, AND FORM DATA COLLECTION ---
// -----------------------------------------------------

function parseBedroomRange(bedroomStr) {
    if (typeof bedroomStr === 'number') {
        const val = parseInt(bedroomStr);
        return [val, val];
    }
    const s = String(bedroomStr).trim();
    if (s.includes('-')) {
        const parts = s.split('-');
        return [parseInt(parts[0]), parseInt(parts[1])];
    }
    try {
        const val = parseInt(s);
        return [val, val];
    } catch {
        return [0, 10];
    }
}

function scoreAgency(agency, answers) {
    let score = 0;
    let reasons = [];

    const minRent = agency.Min_Rent || 0;
    const maxRent = agency.Max_Rent || 1000000;
    const petFriendly = String(agency.Pet_Friendly).toLowerCase() === "yes";
    const [minBeds, maxBeds] = parseBedroomRange(agency.Bedrooms || "0-10");
    const matchTags = (agency.Match_Tags || []).map(t => t.toLowerCase());

    const monthlyIncome = answers.total_income; 
    const pets = answers.pets;
    const bedroomPref = answers.bedrooms;
    const dependents = answers.dependents;
    const currentHousing = answers.current_housing;
    const needsAccessible = answers.needs_accessible;

    // 1. Affordability
    if (monthlyIncome > 0) {
        const budgetMax = monthlyIncome / 3;
        if (minRent <= budgetMax) {
            score += 3;
            reasons.push("Rent range roughly fits your income.");
        } else if (minRent <= budgetMax * 1.2) {
            score += 1;
            reasons.push("Rent is a bit high but possibly workable.");
        } else {
            score -= 4;
            reasons.push("Rent may be too high for your income.");
        }
    }

    // 2. Bedroom match
    if (minBeds <= bedroomPref && bedroomPref <= maxBeds) {
        score += 3;
        reasons.push(`Offers your preferred ${bedroomPref} bedroom(s).`);
    } else {
        score -= 1;
        reasons.push("Bedroom count may not fit your preference.");
    }

    // 3. Pets
    if (pets > 0) {
        if (petFriendly) {
            score += 2;
            reasons.push("Pet friendly.");
        } else {
            score -= 6;
            reasons.push("May not allow pets.");
        }
    }

    // 4. Family-friendly tag
    if (dependents > 0 && matchTags.includes("family-friendly")) {
        score += 2;
        reasons.push("Flagged as family-friendly.");
    }

    // 5. Accessibility
    if (needsAccessible === "true") {
        if (matchTags.includes("accessible") || matchTags.includes("accessibility-support")) {
            score += 2;
            reasons.push("May be more accessible-friendly.");
        } else {
            score -= 1;
            reasons.push("Accessibility features not clearly listed.");
        }
    }
    
    // 6. Current housing situation
    if (currentHousing === "Currently unhoused") {
        if (minRent <= 1100) {
            score += 2;
            reasons.push("Lower starting rent, possibly more reachable for unhoused status.");
        }
        if (matchTags.includes("voucher-friendly")) {
            score += 3;
            reasons.push("Tagged as voucher-friendly.");
        }
    }

    return { score, reasons };
}

function matchTopAgencies(allData, answers, topN = 3) {
    const scored = allData.map(agency => {
        const { score, reasons } = scoreAgency(agency, answers);
        return { score, agency, reasons };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

function getFormAnswers() {
    const baseIncome = parseInt(getRadioValue('income'));
    const partnerIncome = parseInt(getRadioValue('partner_income'));
    const currentHousing = getRadioValue('current_housing');
    
    const answers = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        total_income: baseIncome + partnerIncome,
        bedrooms: parseInt(getRadioValue('bedrooms')),
        dependents: parseInt(getRadioValue('dependents')),
        pets: parseInt(getRadioValue('pets')),
        needs_accessible: getRadioValue('needs_accessible'),
        current_housing: currentHousing,
        eviction: document.getElementById('eviction').checked, 
        criminal_record: document.getElementById('criminal_record').checked,
        needs_transit: document.getElementById('needs_transit').checked,
    };

    // --- ADD BRANCHED ANSWERS ---
    if (currentHousing === "Currently unhoused") {
        // Only collect values if the section is visible
        if (document.getElementById('unhoused-section').style.display === 'block') {
            answers.unhoused_description = document.getElementById('unhoused_desc').value;
            answers.unhoused_how_long = getRadioValue('unhoused_how_long');
            answers.unhoused_where = getRadioValue('unhoused_where');
            answers.unhoused_case_manager = getRadioValue('unhoused_case_manager') === 'true';
        }
    } else if (currentHousing === "At risk of losing housing") {
         if (document.getElementById('at-risk-section').style.display === 'block') {
            answers.risk_description = document.getElementById('risk_desc').value;
            answers.risk_lease_in_name = getRadioValue('risk_lease_in_name') === 'true';
            answers.risk_eviction_notice = getRadioValue('risk_eviction_notice') === 'true';
            answers.risk_behind_bills = getRadioValue('risk_behind_bills') === 'true';
            answers.risk_want_to_stay = getRadioValue('risk_want_to_stay') === 'true';
            answers.risk_lease_length = getRadioValue('risk_lease_length');
        }
    } else if (currentHousing === "Staying with friends or family") {
        if (document.getElementById('family-section').style.display === 'block') {
            answers.family_description = document.getElementById('family_desc').value;
            answers.family_stay_length = getRadioValue('family_stay_length');
            answers.family_contribute = getRadioValue('family_contribute') === 'true';
            answers.family_on_lease = getRadioValue('family_on_lease') === 'true';
            answers.family_perm_plan = getRadioValue('family_perm_plan') === 'true';
        }
    }
    return answers;
}

// -----------------------------------------------------
// --- CSV DOWNLOAD AND DISPLAY ---
// -----------------------------------------------------

function triggerCSVDownload() {
    if (LAST_ANSWERS && LAST_MATCHES) {
        saveResultsAsCSV(LAST_ANSWERS, LAST_MATCHES);
    } else {
        alert("Error: Results data not available for download. Please run the match first.");
    }
}

function displayResults(matches) {
    const resultsDiv = document.getElementById('results-container');
    resultsDiv.innerHTML = '<h2>Top 3 Suggested Housing Options</h2>';

    if (matches.length === 0) {
        resultsDiv.innerHTML += '<p>No matches found based on the provided criteria. Try adjusting your input.</p>';
    }

    matches.forEach((match, index) => {
        const agency = match.agency;
        const reasonsHtml = match.reasons.map(r => `<li>${r}</li>`).join('');
        
        resultsDiv.innerHTML += `
            <div class="match-result">
                <h3>#${index + 1}: ${agency.Organization} (Score: ${match.score})</h3>
                <p><strong>Phone:</strong> ${agency.Phone || 'N/A'} | <strong>Address:</strong> ${agency.Address || 'N/A'}</p>
                <p><strong>Rent Range:</strong> $${agency.Min_Rent} – $${agency.Max_Rent} | <strong>Bedrooms:</strong> ${agency.Bedrooms}</p>
                <p><strong>Pet Friendly:</strong> ${agency.Pet_Friendly || 'Unknown'} | <strong>Notes:</strong> ${agency.Notes || 'N/A'}</p>
                <p><strong>Why this matched:</strong></p>
                <ul>${reasonsHtml}</ul>
            </div>
        `;
    });

    // Add the download button after the results
    resultsDiv.innerHTML += `<br><button id="download-csv-button">Download Results CSV</button>`;
    
    // Attach the function to the button
    document.getElementById('download-csv-button').onclick = triggerCSVDownload;
}

function saveResultsAsCSV(answers, topMatches) {
    const name = answers.name.trim().replace(/\s+/g, '_'); 
    const email = answers.email.trim();
    const filename = `${name}_${email}.csv`.replace(/@/g, '_at_').replace(/\./g, '_dot_'); 

    let csvContent = "data:text/csv;charset=utf-8,";
    
    csvContent += "User Information\n";
    csvContent += `"Name", "${answers.name}"\n`;
    csvContent += `"Email", "${answers.email}"\n\n`;

    csvContent += "Survey Answers\n";
    const excludedKeys = ['name', 'email']; 
    for (const key in answers) {
        if (answers.hasOwnProperty(key) && !excludedKeys.includes(key)) {
            let value = answers[key];
            if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            }
            const escape = (text) => `"${String(text).replace(/"/g, '""')}"`;
            csvContent += `"${key}", ${escape(value)}\n`;
        }
    }
    csvContent += "\n";

    csvContent += "Top 3 Housing Matches\n";
    csvContent += "Rank,Organization,Score,Phone,Address,Rent Range,Bedrooms,Pet Friendly,Why it matched\n";

    topMatches.forEach((match, index) => {
        const agency = match.agency;
        const reasons = match.reasons.join("; "); 
        
        const escape = (text) => `"${String(text).replace(/"/g, '""')}"`;

        const row = [
            index + 1,
            escape(agency.Organization),
            match.score,
            escape(agency.Phone || 'N/A'),
            escape(agency.Address || 'N/A'),
            escape(`$${agency.Min_Rent} – $${agency.Max_Rent}`),
            escape(agency.Bedrooms),
            escape(agency.Pet_Friendly || 'Unknown'),
            escape(reasons)
        ];
        csvContent += row.join(",") + "\n";
    });

    // Trigger Download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log(`Saved results to CSV file: ${filename}`);
}


// --- MAIN FUNCTION ---

function runSurvey(event) {
    event.preventDefault(); // Stop the form from submitting normally
    
    // Check if required radio buttons are selected
    if (!getRadioValue('income') || !getRadioValue('partner_income') || !getRadioValue('bedrooms') || !getRadioValue('dependents') || !getRadioValue('pets') || !getRadioValue('needs_accessible') || !getRadioValue('current_housing')) {
        alert("Please answer all required core questions.");
        return;
    }

    const answers = getFormAnswers();
    const topMatches = matchTopAgencies(HOUSING_DATA, answers, 3);
    
    // Store results globally 
    LAST_ANSWERS = answers;
    LAST_MATCHES = topMatches;
    
    // Display results (which now includes the download button)
    displayResults(topMatches);

    // Scroll to results
    document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
}
