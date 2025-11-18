// Variable to hold the loaded JSON data
let HOUSING_DATA = [];

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

// --- HELPER FUNCTIONS ---

function parseBedroomRange(bedroomStr) {
    // Logic translated from Survey.py's parse_bedroom_range function
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
        return [0, 10]; // very loose default if data is messy
    }
}

// --- SCORING LOGIC TRANSLATED FROM Survey.py ---

function scoreAgency(agency, answers) {
    let score = 0;
    let reasons = [];

    // Pull fields with safe defaults
    const minRent = agency.Min_Rent || 0;
    const maxRent = agency.Max_Rent || 1000000;
    const petFriendly = String(agency.Pet_Friendly).toLowerCase() === "yes";
    const [minBeds, maxBeds] = parseBedroomRange(agency.Bedrooms || "0-10");
    const matchTags = (agency.Match_Tags || []).map(t => t.toLowerCase());

    // User Answers
    const monthlyIncome = answers.total_income; 
    const pets = answers.pets;
    const bedroomPref = answers.bedrooms;
    const dependents = answers.dependents;
    const currentHousing = answers.current_housing;
    const needsAccessible = answers.needs_accessible;

    // 1. Affordability (~1/3 income to rent)
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
    
    scored.sort((a, b) => b.score - a.score); // Sort by score, highest first
    return scored.slice(0, topN);
}

// --- FORM HANDLER AND DISPLAY ---

function getFormAnswers() {
    // Collects all user answers from the HTML form
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const baseIncome = parseInt(document.getElementById('income').value);
    const partnerIncome = parseInt(document.getElementById('partner_income').value);
    const bedrooms = parseInt(document.getElementById('bedrooms').value);
    const dependents = parseInt(document.getElementById('dependents').value);
    const pets = parseInt(document.getElementById('pets').value);
    const needsAccessible = document.getElementById('needs_accessible').value;
    const currentHousing = document.getElementById('current_housing').value;

    return {
        name,
        email,
        total_income: baseIncome + partnerIncome,
        bedrooms,
        dependents,
        pets,
        needs_accessible: needsAccessible,
        current_housing: currentHousing,
        // The checkboxes are not used in scoring yet, but included for context
        eviction: document.getElementById('eviction').checked, 
        criminal_record: document.getElementById('criminal_record').checked,
        needs_transit: document.getElementById('needs_transit').checked,
    };
}

function displayResults(matches) {
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
}

function runSurvey(event) {
    event.preventDefault(); // Stop the form from submitting normally
    
    const answers = getFormAnswers();
    const topMatches = matchTopAgencies(HOUSING_DATA, answers, 3);
    
    displayResults(topMatches);

    // Scroll to results
    document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
}

// The event listener is attached in the fetch promise after data loads.