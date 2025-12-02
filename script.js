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

// --- BRANCHING LOGIC FOR PETS (RESTORED FROM PREVIOUS FIXES) ---

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
    // Note: showBreedField is not defined in this snippet but is required if you are using pet branching in index.html
    // Assuming you have a showBreedField() function from the previous complete code, if not, it will be missing.
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
        // showPetSections(); // Uncomment this line if you re-add the pet branching logic and the function

        // INCOME SLIDER DISPLAY LOGIC (FIXED)
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
    let score = 0; 
    let reasons = [];

    const minRent = agency.Min_Rent || 0;
    const maxRent = agency.Max_Rent || 1000000;
    const petFriendly = String(agency.Pet_Friendly).toLowerCase() === "yes";
    const [minBeds, maxBeds] = parseBedroomRange(agency.Bedrooms || "0-10");
    const matchTags = (agency.Match_Tags || []).map(t => t.toLowerCase());

    const monthlyIncome = answers.total_income; 
    // FIXED: Using 'pets' radio value ('Yes'/'No') from HTML, not the old numeric value.
    const hasPets = answers.pets === 'Yes'; 
    const kids = answers.kids; // Using kids for family-friendly check
    const bedroomPref = answers.bedrooms;
    const currentHousing = answers.current_housing;
    const needsAccessible = answers.needs_accessible; // 'Yes' or 'No'

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

    //
