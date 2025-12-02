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

// --- BRANCHING LOGIC FOR CURRENT SITUATION ---

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

// --- BRANCHING LOGIC FOR PETS ---

function showPetSections() {
    const petStatus = getRadioValue('pets');
    const petDetailsDiv = document.getElementById('pet-details-section');
    if (petStatus === 'Yes') {
        petDetailsDiv.style.display = 'block';
    } else {
        petDetailsDiv.style.display = 'none';
        // Clear pet details if section is hidden (good practice)
        document.querySelectorAll('input[name="pet_weight"], input[name="restricted_breed"]').forEach(radio => radio.checked = false);
        document.getElementById('breed_description').value = '';
    }
    // Also call breed field logic in case 'Yes' is the initial selection
    showBreedField();
}

function showBreedField() {
    const restricted = getRadioValue('restricted_breed');
    const breedField = document.getElementById('breed-field-section');
    // Show breed input if "Yes" or "I don't know" is selected
    if (restricted === 'Yes' || restricted === 'I don't know') {
        breedField.style.display = 'block';
    } else {
        breedField.style.display = 'none';
        document.getElementById('breed_description').value = '';
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
        
        // --- INITIAL UI SETUP ---
        showBranchingSections(); 
        showPetSections(); // Hide pet details if 'No' is selected initially
        
        // INCOME SLIDER DISPLAY LOGIC
        const incomeSlider = document.getElementById('income-slider');
        const incomeDisplay = document.getElementById('income-display');

        if (incomeSlider && incomeDisplay) {
            const updateIncomeDisplay = (value) => {
                // Ensure value is formatted as currency with comma separation
                incomeDisplay.textContent = `$${parseInt(value).toLocaleString()}`;
            };
            // Set initial value on load
            updateIncomeDisplay(incomeSlider.value);
            // Add event listener to update display on change
            incomeSlider.addEventListener('input', (e) => {
                updateIncomeDisplay(e.target.value);
            });
        }
    })
    .catch(error => {
        console.error("Could not load housing data:", error);
        document.getElementById('results-container').innerHTML = 
            `<h2>Error: Could not load housing data. Check if 'housing_data.json' is in the same folder.</h2>`;
    });

// --- SCORING AND MATCHING LOGIC ---

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
    let score = 0; // This is the raw score before scaling
    let reasons = [];

    const minRent = agency.Min_Rent || 0;
    const maxRent = agency.Max_Rent || 1000000;
    const petFriendly = String(agency.Pet_Friendly).toLowerCase() === "yes";
    const [minBeds, maxBeds] = parseBedroomRange(agency.Bedrooms || "0-10");
    const matchTags = (agency.Match_Tags || []).map(t => t.toLowerCase());

    const monthlyIncome = answers.total_income; 
    const currentHousing = answers.current_housing;
    const needsAccessible = answers.needs_accessible; // 'true' or 'false'

    // Core Needs for Scoring
    const hasPets = answers.pets === 'Yes';
    const kids = answers.kids; // Count of kids for family-friendly check
    const bedroomPref = answers.bedrooms;

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
    if (hasPets) {
        if (petFriendly) {
            score += 2;
            reasons.push("Pet friendly.");
            
            // Add specific pet rules
            if (answers.pet_weight === 'Yes') {
                score -= 1;
                reasons.push("Note: Your pet is over 25 lbs, which may limit options.");
            }
            if (answers.restricted_breed === 'Yes') {
                score -= 3;
                reasons.push("Critical: Your pet is a restricted breed, which heavily limits options.");
            }
        } else {
            score -= 6;
            reasons.push("May not allow pets.");
        }
    }

    // 4. Family-friendly tag
    if (kids > 0 && matchTags.includes("family-friendly")) {
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

    // --- SCALING LOGIC: Convert raw score to a 1-10 scale ---
    const MIN_RAW_SCORE = -12; 
    const MAX_RAW_SCORE = 17; 
    const RANGE_RAW = MAX_RAW_SCORE - MIN_RAW_SCORE; // 29

    // 1. Normalize raw score to a 0-1 range
    const normalizedScore = (score - MIN_RAW_SCORE) / RANGE_RAW;

    // 2. Scale to 1-10 range: Scaled = Normalized * (10 - 1) + 1
    let scaledScore = normalizedScore * 9 + 1;
    
    // 3. Ensure the score is clamped exactly between 1.0 and 10.0
    scaledScore = Math.max(1.0, Math.min(10.0, scaledScore));
    
    // 4. Round to one decimal place for presentation
    scaledScore = Math.round(scaledScore * 10) / 10;
    // --------------------------------------------------------

    return { score: scaledScore, reasons };
}

function matchTopAgencies(allData, answers, topN = 3) {
    const scored = allData.map(agency => {
        const { score, reasons } = scoreAgency(agency, answers);
        return { score, agency, reasons };
    });
    
    // Sorting by the new scaled score (1.0 to 10.0)
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

// --- FORM DATA COLLECTION ---

function getFormAnswers() {
    const currentHousing = getRadioValue('current_housing');
    
    const answers = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        
        // Core Needs
        total_income: parseInt(document.getElementById('income-slider').value),
        bedrooms: parseInt(getRadioValue('bedrooms')),
        adults: parseInt(getRadioValue('adults')),
        kids: parseInt(getRadioValue('kids')),
        // Using kids as dependents for scoring logic consistency
        dependents: parseInt(getRadioValue('kids')), 
        pets: getRadioValue('pets'), // 'Yes' or 'No'
        
        // Convert 'Yes' to 'true' for scoring function
        needs_accessible: getRadioValue('needs_accessible') === 'Yes' ? 'true' : 'false', 
        current_housing: currentHousing,
        
        // Other Factors (using getRadioValue for the radio groups)
        eviction: getRadioValue('eviction'), 
        criminal_record: getRadioValue('criminal_record'),
        needs_transit: getRadioValue('needs_transit'),
    };

    // --- ADD PET BRANCHED ANSWERS ---
    if (answers.pets === "Yes") {
        if (document.getElementById('pet-details-section').style.display === 'block') {
            answers.pet_weight = getRadioValue('pet_weight');
            answers.restricted_breed = getRadioValue('restricted_breed');
            if (answers.restricted_breed === 'Yes' || answers.restricted_breed === 'I don't know') {
                answers.breed_description = document.getElementById('breed_description').value;
            } else {
                answers.breed_description = '';
            }
        }
    }
    
    // --- ADD HOUSING BRANCHED ANSWERS ---
    if (currentHousing === "Currently unhoused") {
        if (document.getElementById('unhoused-section').style.display === 'block') {
            answers.unhoused_description = document.getElementById('unhoused_desc').value;
            answers.unhoused_how_long = getRadioValue('unhoused_how_long');
            answers.unhoused_where = getRadioValue('unhoused_where');
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

// --- CSV DOWNLOAD LOGIC ---

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
        
        // Ensure score is formatted to one decimal place
        const formattedScore = match.score.toFixed(1);

        resultsDiv.innerHTML += `
            <div class="match-result">
                <h3>#${index + 1}: ${agency.Organization} (Score: ${formattedScore})</h3>
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
    const excludedKeys = ['name', 'email', 'dependents']; // dependents is an internal scoring value
    for (const key in answers) {
        if (answers.hasOwnProperty(key) && !excludedKeys.includes(key)) {
            let value = answers[key];
            if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            }
            // If the value is 'true'/'false' from radio groups, format it as 'Yes'/'No' for the CSV
            if (value === 'true' || value === 'false') {
                value = value === 'true' ? 'Yes' : 'No';
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
            match.score.toFixed(1), // Ensure score is saved correctly
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
    
    // Check if required questions are answered
    if (
        !document.getElementById('income-slider').value || 
        !getRadioValue('bedrooms') || 
        !getRadioValue('adults') ||
        !getRadioValue('kids') ||
        !getRadioValue('pets') ||
        !getRadioValue('needs_accessible') ||
        !getRadioValue('current_housing') ||
        !getRadioValue('eviction') ||
        !getRadioValue('criminal_record') ||
        !getRadioValue('needs_transit')
    ) {
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
