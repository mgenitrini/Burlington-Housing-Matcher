// --- FORM DATA COLLECTION ---

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
        // ✅ CORRECTED: These lines ensure the "Yes" or "No" text is saved, not 'true' or 'false'
        eviction: getRadioValue('eviction'), 
        criminal_record: getRadioValue('criminal_record'),
        needs_transit: getRadioValue('needs_transit'),
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
