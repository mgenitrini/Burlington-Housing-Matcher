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

// --- FUNCTION: Update the income display in real-time ---
function updateIncomeDisplay(val) {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    document.getElementById('income-display').textContent = formatter.format(val);
}

// --- BRANCHING LOGIC ---

// Function to handle the visibility of the detailed breed question
function showBreedField() {
    const restricted = getRadioValue('restricted_breed');
    const breedField = document.getElementById('breed-field-section');
    
    if (restricted === "I don't know") {
        breedField.style.display = 'block';
    } else {
        breedField.style.display = 'none';
        // Clear the input if it's hidden
        document.getElementById('breed_description').value = '';
    }
}

// Function to handle the visibility of the main pet details section
function showPetSections() {
    const hasPets = getRadioValue('pets'); 
    const petDetailsSection = document.getElementById('pet-details-section');

    if (hasPets === "Yes") {
        petDetailsSection.style.display = 'block';
        // Ensure the nested breed field logic runs when this section appears/reappears
        showBreedField(); 
    } else {
        petDetailsSection.style.display = 'none';
        // Clear pet details radio buttons if 'No' is selected
        document.querySelectorAll('input[name="pet_weight"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="restricted_breed"]').forEach(r => r.checked = false);
        // Hide and clear nested breed field
        document.getElementById('breed-field-section').style.display = 'none';
        document.getElementById('breed_description').value = '';
    }
}


// UPDATED: Handles new order and new "Own place" section
function showBranchingSections() {
    const status = getRadioValue('current_housing'); 
    
    // Hide all sections first
    document.getElementById('unhoused-section').style.display = 'none';
    document.getElementById('at-risk-section').style.display = 'none';
    document.getElementById('family-section').style.display = 'none';
    document.getElementById('own-place-section').style.display = 'none'; // New Section

    
    // Show the relevant section based on the new order
    if (status === "Currently unhoused") {
        document.getElementById('unhoused-section').style.display = 'block';
    } else if (status === "Staying with friends or family") { // Value remains "Staying with friends or family" in script to match old input
        document.getElementById('family-section').style.display = 'block';
    } else if (status === "At risk of losing housing") {
        document.getElementById('at-risk-section').style.display = 'block';
    } else if (status === "Own place") { // New value "Own place"
        document.getElementById('own-place-section').style.display = 'block';
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
        // Attach the form submission listener
        document.getElementById('housing-survey').addEventListener('submit', runSurvey);
        
        // --- SLIDER LISTENER ATTACHMENT ---
        const incomeSlider = document.getElementById('income-slider');
        
        // Attach the update function to the 'input' event to make it drag-responsive
        incomeSlider.addEventListener('input', (event) => {
            updateIncomeDisplay(event.target.value);
        });
        
        // Initial call to hide sections and set initial display value
        showBranchingSections(); 
        showPetSections(); 
        
        const initialIncome = incomeSlider.value;
        updateIncomeDisplay(initialIncome);
    })
    .catch(error => {
        console.error("Could not load housing data:", error);
        document.getElementById('results-container').innerHTML = 
            `<h2>Error: Could not load housing data. Check if 'housing_data.json' is in the same folder.</h2>`;
    });

// --- SCORING AND MATCHING LOGIC (Keep for functionality) ---

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
    const kids = answers.kids;
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
    if (pets === 'Yes') { 
        if (petFriendly) {
            score += 2;
            reasons.push("Pet friendly.");
            
            const isLargeOrRestricted = answers.pet_weight === 'Yes' || answers.restricted_breed === 'Yes' || answers.restricted_breed === "I don't know";
            
            if (isLargeOrRestricted) {
                score -= 1;
                reasons.push("NOTE: Your pet may be large or a restricted breed, which could incur extra fees or property specific rules.");
            }

        } else {
            score -= 6;
            reasons.push("May not allow pets.");
        }
    }

    // 4. Family-friendly tag 
    if (kids > 0 && matchTags.includes("family-friendly")) {
        score += 2;
        reasons.push("Flagged as family-friendly due to having kids.");
    }

    // 5. Accessibility
    if (needsAccessible === "Yes") { 
        if (matchTags.includes("accessible") || matchTags.includes("accessibility-support")) {
            score += 2;
            reasons.push("May be more accessible-friendly.");
        } else {
            score -= 1;
            reasons.push("Accessibility features not clearly listed.");
        }
    }
    
    // 6. Current housing situation (Simple score for unhoused/at-risk remains)
    if (currentHousing === "Currently unhoused" || currentHousing === "At risk of losing housing") {
        if (minRent <= 1100) {
            score += 2;
            reasons.push("Lower starting rent, possibly more reachable for current situation.");
        }
        if (matchTags.includes("voucher-friendly")) {
            score += 3;
            reasons.push("Tagged as voucher-friendly.");
        }
    }
    
    // --- SCALING LOGIC: Convert raw score to a 1-10 scale ---
    const MIN_RAW_SCORE = -12; 
    const MAX_RAW_SCORE = 17; 
    const RANGE_RAW = MAX_RAW_SCORE - MIN_RAW_SCORE;

    const normalizedScore = (score - MIN_RAW_SCORE) / RANGE_RAW;
    let scaledScore = normalizedScore * 9 + 1;
    
    scaledScore = Math.max(1.0, Math.min(10.0, scaledScore));
    scaledScore = Math.round(scaledScore * 10) / 10;

    return { score: scaledScore, reasons };
}

function matchTopAgencies(allData, answers, topN = 3) {
    const scored = allData.map(agency => {
        const { score, reasons } = scoreAgency(agency, answers);
        return { score, agency, reasons };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

// --- FORM DATA COLLECTION ---

function getFormAnswers() {
    const incomeSlider = document.getElementById('income-slider');
    const baseIncome = parseInt(incomeSlider.value);

    const currentHousing = getRadioValue('current_housing');
    const hasPets = getRadioValue('pets');
    
    const answers = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        total_income: baseIncome, // Now reading from slider
        bedrooms: parseInt(getRadioValue('bedrooms')),
        adults: parseInt(getRadioValue('adults')), 
        kids: parseInt(getRadioValue('kids')), 
        pets: hasPets, 
        needs_accessible: getRadioValue('needs_accessible'),
        current_housing: currentHousing,
        eviction: getRadioValue('eviction'), 
        criminal_record: getRadioValue('criminal_record'),
        needs_transit: getRadioValue('needs_transit'),
    };
    
    // --- ADD CONDITIONAL PET ANSWERS ---
    if (hasPets === "Yes") {
        answers.pet_weight = getRadioValue('pet_weight');
        answers.restricted_breed = getRadioValue('restricted_breed');
        
        if (answers.restricted_breed === "I don't know") {
            answers.breed_description = document.getElementById('breed_description').value;
        }
    }


    // --- UPDATED ADD BRANCHED HOUSING ANSWERS ---
    if (currentHousing === "Currently unhoused") {
        if (document.getElementById('unhoused-section').style.display === 'block') {
            answers.unhoused_description = document.getElementById('unhoused_desc').value;
            answers.unhoused_how_long = getRadioValue('unhoused_how_long');
            answers.unhoused_where = getRadioValue('unhoused_where');
            // Removed answers.unhoused_case_manager
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
    } else if (currentHousing === "Own place") { // NEW BRANCH
        if (document.getElementById('own-place-section').style.display === 'block') {
            answers.own_afford_length = getRadioValue('own_afford_length');
            answers.own_behind_bills = getRadioValue('own_behind_bills') === 'true';
        }
    }
    return answers;
}

// --- CSV DOWNLOAD LOGIC (Keep for functionality) ---

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
    const excludedKeys = ['name', 'email']; 
    for (const key in answers) {
        if (answers.hasOwnProperty(key) && !excludedKeys.includes(key)) {
            let value = answers[key];
            
            if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            } else if (typeof value === 'string' && (value === 'true' || value === 'false')) {
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
            match.score.toFixed(1),
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


// --- MAIN FUNCTION: Runs the matching logic on form submit ---

function runSurvey(event) {
    event.preventDefault(); // Stop the form from submitting normally
    
    // Basic check for required core radio buttons
    if (
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
    
    // Basic validation for contact info
    if (!answers.name || !answers.email) {
        alert("Please provide your full name and email.");
        return;
    }
    
    // Check if HOUSING_DATA was successfully loaded
    if (HOUSING_DATA.length === 0) {
        alert("The housing data has not loaded correctly. Check the console for errors.");
        return;
    }

    const topMatches = matchTopAgencies(HOUSING_DATA, answers, 3);
    
    // Store results globally 
    LAST_ANSWERS = answers;
    LAST_MATCHES = topMatches;
    
    // Display results (which now includes the download button)
    displayResults(topMatches);

    // Scroll to results
    document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
}
