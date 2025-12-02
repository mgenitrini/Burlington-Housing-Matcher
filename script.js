// Variable to hold the loaded JSON data
let HOUSING_DATA = [];

// --- HELPER FUNCTIONS ---

// Function to get the checked value of a radio group by its name attribute
function getRadioValue(name) {
    const selector = `input[name="${name}"]:checked`;
    const element = document.querySelector(selector);
    return element ? element.value : null; 
}

function parseBedroomRange(bedroomStr) {
    if (typeof bedroomStr === 'number' || typeof bedroomStr === 'number') {
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

// --- CSV LOGIC ---

function arrayToCsv(data) {
    const header = Object.keys(data[0]).join(',');
    
    const rows = data.map(obj => 
        Object.values(obj).map(val => 
            `"${String(val).replace(/"/g, '""')}"`
        ).join(',')
    );
    return [header, ...rows].join('\n');
}

function generateCSV(matches, answers) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${answers.name || 'Survey'}_${timestamp}.csv`;

    const dataRows = matches.map((match, index) => {
        return {
            Rank: index + 1,
            Agency_Name: match.agency.Organization,
            Score: match.score,
            Rent_Range: `$${match.agency.Min_Rent} - $${match.agency.Max_Rent}`,
            Bedrooms_Offered: match.agency.Bedrooms,
            Match_Reasons: match.reasons.join('; '),
            User_Name: answers.name,
            User_Email: answers.email,
            User_Total_Income: answers.total_income,
            User_Bedrooms_Pref: answers.bedrooms,
            User_Eviction_Record: answers.eviction, 
            User_Criminal_Record: answers.criminal_record,
            User_Needs_Transit: answers.needs_transit,
        };
    });

    const csvContent = arrayToCsv(dataRows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


// --- SCORING LOGIC ---

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
    } else if (bedroomPref === maxBeds + 1 || bedroomPref === minBeds - 1) {
        score += 1;
        reasons.push("Bedroom count is close to what you want.");
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
    } else {
        score += 1;
        reasons.push("No pets (usually easier approvals).");
    }

    // 4. Family-friendly tag if they have dependents
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
    } else if (currentHousing === "At risk of losing housing") {
        if (minRent <= 1300) {
            score += 1;
            reasons.push("Mid-range rent may help stabilize housing.");
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

// --- FORM HANDLER AND DISPLAY ---

/**
 * Handles showing and hiding the conditional sections 
 * when a user selects a "Current housing situation" radio button.
 */
function showBranchingSections() {
    const unhousedDiv = document.getElementById('unhoused-section');
    const atRiskDiv = document.getElementById('at-risk-section');
    const familyDiv = document.getElementById('family-section');
    
    const selectedHousing = getRadioValue('current_housing'); 

    // Hide all sections initially
    unhousedDiv.style.display = 'none';
    atRiskDiv.style.display = 'none';
    familyDiv.style.display = 'none';

    // Show only the relevant section
    if (selectedHousing === 'Currently unhoused') {
        unhousedDiv.style.display = 'block';
    } else if (selectedHousing === 'At risk of losing housing') {
        atRiskDiv.style.display = 'block';
    } else if (selectedHousing === 'Staying with friends or family') {
        familyDiv.style.display = 'block';
    }
}


function getFormAnswers() {
    // Text inputs still use getElementById
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    
    // Radio buttons now use the custom getRadioValue function and name attribute
    const baseIncome = parseInt(getRadioValue('income'));
    const partnerIncome = parseInt(getRadioValue('partner_income') || 0); 
    const bedrooms = parseInt(getRadioValue('bedrooms'));
    const dependents = parseInt(getRadioValue('dependents'));
    const pets = parseInt(getRadioValue('pets'));
    const needsAccessible = getRadioValue('needs_accessible');
    const currentHousing = getRadioValue('current_housing');
    
    // Other Factors 
    const eviction = getRadioValue('eviction'); 
    const criminalRecord = getRadioValue('criminal_record');
    const needsTransit = getRadioValue('needs_transit');


    return {
        name,
        email,
        total_income: baseIncome + partnerIncome,
        bedrooms,
        dependents,
        pets,
        needs_accessible: needsAccessible,
        current_housing: currentHousing,
        eviction: eviction, 
        criminal_record: criminalRecord,
        needs_transit: needsTransit,
    };
}

function displayResults(matches, answers) {
    const resultsDiv = document.getElementById('results-container');
    resultsDiv.innerHTML = '<h2>Top 3 Suggested Housing Options</h2>';

    if (matches.length === 0) {
        resultsDiv.innerHTML += '<p>No matches found based on the provided criteria. Try adjusting your input.</p>';
        return;
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
    
    // The CSV Download Button is added here
    const downloadButton = document.createElement('button');
    downloadButton.id = 'download-csv-button';
    downloadButton.textContent = 'Download Matches (CSV)';
    downloadButton.addEventListener('click', () => generateCSV(matches, answers)); 
    resultsDiv.appendChild(downloadButton);
}

function runSurvey(event) {
    event.preventDefault(); 
    
    const answers = getFormAnswers();

    // CRITICAL VALIDATION CHECK: Check ALL required fields
    const requiredNumericFields = [
        answers.total_income,
        answers.bedrooms,
        answers.dependents,
        answers.pets
    ];
    
    const requiredStringFields = [
        answers.current_housing,
        answers.eviction,
        answers.criminal_record,
        answers.needs_transit
    ];
    
    const isInvalid = requiredNumericFields.some(val => isNaN(val)) || 
                      requiredStringFields.some(val => val === null);

    if (isInvalid) {
        document.getElementById('results-container').innerHTML = 
            '<h2>🛑 Error: Please complete ALL required selections.</h2><p>You must select one option for every single question in the "Core Needs," "Current Situation," and "Other Factors" sections to get a match.</p>';
        
        document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    
    const topMatches = matchTopAgencies(HOUSING_DATA, answers, 3);
    
    displayResults(topMatches, answers); 
    document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
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
    })
    .catch(error => {
        console.error("Could not load housing data:", error);
        document.getElementById('results-container').innerHTML = 
            '<h2>Error: Could not load housing data. Check the file path.</h2>';
    });
