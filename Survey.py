import json
import sys
import csv

# ------------------ LOAD HOUSING DATA ------------------

def load_housing_data(path="housing_data.json"):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

# ------------------ QUESTION HELPERS ------------------

def ask_mc(question, options):
    """
    Ask a multiple-choice question in the terminal.
    Returns the index (1-based) of the selected option.
    """
    print("\n" + question)
    for i, opt in enumerate(options, start=1):
        print(f"{i}. {opt}")
    while True:
        choice = input("Enter the number of your choice: ").strip()
        if choice.isdigit():
            choice = int(choice)
            if 1 <= choice <= len(options):
                return choice
        print("Please enter a valid option number.")

def income_from_choice(choice):
    """
    Map the main income question to an approximate monthly income.
    1 = 1,000–1,500   -> 1,250
    2 = 1,500–2,000   -> 1,750
    3 = Over 2,000    -> 2,500 (rough default)
    """
    mapping = {1: 1250, 2: 1750, 3: 2500}
    return mapping.get(choice, 0)

def combined_income_from_choice(choice):
    """
    Map the combined income question to an approximate monthly income.
    1 = Under 1,000   -> 750
    2 = 1,000–1,500   -> 1,250
    3 = 1,500–2,000   -> 1,750
    4 = Over 2,000    -> 2,500
    """
    mapping = {1: 750, 2: 1250, 3: 1750, 4: 2500}
    return mapping.get(choice, 0)

def parse_bedroom_range(bedroom_str):
    """
    Expects '1-3', '2-2', '3', etc. Returns (min_beds, max_beds).
    """
    if isinstance(bedroom_str, (int, float)):
        val = int(bedroom_str)
        return val, val

    s = str(bedroom_str).strip()
    if "-" in s:
        parts = s.split("-")
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            pass

    try:
        val = int(s)
        return val, val
    except ValueError:
        return 0, 10  # very loose default if data is messy

# ------------------ SCORING LOGIC ------------------

def score_agency(agency, answers):
    """
    Score a single agency for the given answers.
    Higher score = better match.
    """
    score = 0
    reasons = []

    # Pull fields with safe defaults
    min_rent = agency.get("Min_Rent", 0) or 0
    max_rent = agency.get("Max_Rent", 10**9) or 10**9
    pet_friendly = str(agency.get("Pet_Friendly", "")).lower() == "yes"
    bedrooms_str = agency.get("Bedrooms", "0-10")
    min_beds, max_beds = parse_bedroom_range(bedrooms_str)
    match_tags = [t.lower() for t in agency.get("Match_Tags", [])]

    monthly_income = answers["total_income"]
    pets = answers["pets"]
    bedroom_pref = answers["bedrooms"]
    dependents = answers["dependents"]
    current_housing = answers["current_housing"]
    needs_accessible = answers["needs_accessible"]

    # 1. Affordability (simple rule of thumb: ~1/3 income to rent)
    if monthly_income > 0:
        budget_max = monthly_income / 3
        if min_rent <= budget_max:
            score += 3
            reasons.append("rent range roughly fits your income")
        elif min_rent <= budget_max * 1.2:
            score += 1
            reasons.append("rent is a bit high but possibly workable")
        else:
            score -= 4
            reasons.append("rent may be too high for your income")

    # 2. Bedroom match
    if min_beds <= bedroom_pref <= max_beds:
        score += 3
        reasons.append(f"offers your preferred {bedroom_pref} bedroom(s)")
    elif bedroom_pref == max_beds + 1 or bedroom_pref == min_beds - 1:
        score += 1
        reasons.append("bedroom count is close to what you want")
    else:
        score -= 1
        reasons.append("bedroom count may not fit your preference")

    # 3. Pets
    if pets > 0:
        if pet_friendly:
            score += 2
            reasons.append("pet friendly")
        else:
            score -= 6
            reasons.append("may not allow pets")
    else:
        score += 1
        reasons.append("no pets (usually easier approvals)")

    # 4. Family-friendly tag if they have dependents
    if dependents > 0 and "family-friendly" in match_tags:
        score += 2
        reasons.append("flagged as family-friendly")

    # 5. Accessibility
    if needs_accessible:
        if "accessible" in match_tags:
            score += 2
            reasons.append("may be more accessible-friendly")
        else:
            score -= 1
            reasons.append("accessibility features not clearly listed")

    # 6. Current housing situation
    if current_housing == "Currently unhoused":
        if min_rent <= 1100:
            score += 2
            reasons.append("lower starting rent, possibly more reachable")
        if "voucher-friendly" in match_tags:
            score += 3
            reasons.append("tagged as voucher-friendly")
    elif current_housing == "At risk of losing housing":
        if min_rent <= 1300:
            score += 1
            reasons.append("mid-range rent may help stabilize housing")

    return score, reasons

def match_top_agencies(all_data, answers, top_n=3):
    scored = []
    for agency in all_data:
        s, reasons = score_agency(agency, answers)
        scored.append((s, agency, reasons))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_n]

# ------------------ MAIN SURVEY FLOW ------------------

def main():
    print("=== Housing Matching Survey ===")

    # Name + email for filename and record
    name = input("Your full name: ").strip()
    email = input("Your email: ").strip()

    # Create CSV filename like Michael_Genitrini_mggenitrini@icloud.com.csv
    safe_name = name.replace(" ", "_")
    csv_filename = f"{safe_name}_{email}.csv"

    # ---- Core questions (Section 1) ----

    eviction_choice = ask_mc(
        "Do you have a previous eviction on your record?",
        ["Yes", "No"]
    )

    time_choice = ask_mc(
        "How soon do you need housing?",
        ["Within the week", "Within the month", "Within six months", "Within a year"]
    )

    transit_choice = ask_mc(
        "Do you need easy access to public transportation?",
        [
            "Yes, I need close access to a bus or train",
            "I don't have to have it but it is helpful",
            "No, I have my own transportation",
        ]
    )

    criminal_choice = ask_mc(
        "Do you have a criminal record?",
        ["Yes", "No"]
    )

    dependents_choice = ask_mc(
        "Do you have dependents? If so, how many?",
        ["0", "1", "2", "3+"]
    )
    dependents_map = {1: 0, 2: 1, 3: 2, 4: 3}
    dependents = dependents_map[dependents_choice]

    pets_choice = ask_mc(
        "Pet situation:",
        ["No pets", "1 pet", "2+ pets"]
    )
    if pets_choice == 1:
        pets = 0
    elif pets_choice == 2:
        pets = 1
    else:
        pets = 2

    income_choice = ask_mc(
        "Monthly income:",
        ["In between 1,000–1,500", "In between 1,500–2,000", "Over 2,000"]
    )
    base_income = income_from_choice(income_choice)

    combined_choice = ask_mc(
        "If you combine income with someone who also works, what is their monthly income?",
        [
            "Under 1,000",
            "1,000–1,500",
            "1,500–2,000",
            "Over 2,000",
            "I do not combine income",
        ]
    )
    if combined_choice == 5:
        partner_income = 0
    else:
        partner_income = combined_income_from_choice(combined_choice)

    total_income = base_income + partner_income

    bedroom_choice = ask_mc(
        "Bedroom amount preference:",
        ["1", "2", "3", "4"]
    )
    bedrooms = bedroom_choice  # options map directly 1–4

    bathroom_choice = ask_mc(
        "Bathroom preference:",
        ["1", "2", "3", "4"]
    )

    accessible_choice = ask_mc(
        "Do you need disability accessible housing?",
        [
            "Yes, fully accessible (wheelchair, ramps, wide doors, valet trash)",
            "Not fully accessible (few stairs, grab railings, first floor)",
            "No, I do not",
        ]
    )
    needs_accessible = (accessible_choice == 1)

    garage_choice = ask_mc(
        "Do you need a garage?",
        ["Yes", "No"]
    )

    current_housing_choice = ask_mc(
        "Current housing situation:",
        ["Currently unhoused", "At risk of losing housing", "Staying with friends or family"]
    )
    current_housing_map = {
        1: "Currently unhoused",
        2: "At risk of losing housing",
        3: "Staying with friends or family",
    }
    current_housing = current_housing_map[current_housing_choice]

    # ---- Pack core answers ----

    answers = {
        "name": name,
        "email": email,
        "eviction": (eviction_choice == 1),
        "time_frame": time_choice,
        "needs_transit": (transit_choice == 1),
        "criminal_record": (criminal_choice == 1),
        "dependents": dependents,
        "pets": pets,
        "base_income": base_income,
        "partner_income": partner_income,
        "total_income": total_income,
        "bedrooms": bedrooms,
        "bathrooms": bathroom_choice,
        "needs_accessible": needs_accessible,
        "needs_garage": (garage_choice == 1),
        "current_housing": current_housing,
    }

    # ---- Branched sections based on current housing ----

    if current_housing == "Currently unhoused":
        print("\n--- Unhoused Section ---")
        unhoused_desc = input("If you want, briefly describe your situation (optional): ")
        unhoused_how_long_choice = ask_mc(
            "How long have you been without housing?",
            ["Under a year", "Over a year", "Over 5 years"]
        )
        unhoused_where_choice = ask_mc(
            "Where did you sleep last night?",
            ["Shelter", "Outside", "Vehicle", "Motel"]
        )
        case_manager_choice = ask_mc(
            "Are you working with a case manager?",
            ["Yes", "No"]
        )

        answers.update({
            "unhoused_description": unhoused_desc,
            "unhoused_how_long": unhoused_how_long_choice,
            "unhoused_where": unhoused_where_choice,
            "unhoused_case_manager": (case_manager_choice == 1),
        })

    elif current_housing == "At risk of losing housing":
        print("\n--- At Risk of Losing Housing Section ---")
        risk_desc = input("If you want, briefly describe your situation (optional): ")
        lease_in_name_choice = ask_mc(
            "Is the lease in your name?",
            ["Yes", "No"]
        )
        eviction_notice_choice = ask_mc(
            "Have you received an eviction notice?",
            ["Yes", "No"]
        )
        behind_bills_choice = ask_mc(
            "Are you behind on rent and/or utilities?",
            ["Yes", "No"]
        )
        want_stay_choice = ask_mc(
            "Do you want to stay at your place / make it work?",
            ["Yes", "No"]
        )
        lease_length_choice = ask_mc(
            "How long of a lease are you looking for?",
            ["Over six months", "Over a year", "Either"]
        )
        storage_choice = ask_mc(
            "Do you have anything in storage or need help moving your items?",
            ["Yes, a lot of items", "Only a few items", "No, I don't have any items"]
        )

        answers.update({
            "risk_description": risk_desc,
            "risk_lease_in_name": (lease_in_name_choice == 1),
            "risk_eviction_notice": (eviction_notice_choice == 1),
            "risk_behind_bills": (behind_bills_choice == 1),
            "risk_want_to_stay": (want_stay_choice == 1),
            "risk_lease_length": lease_length_choice,
            "risk_storage": storage_choice,
        })

    elif current_housing == "Staying with friends or family":
        print("\n--- Staying With Family or Friends Section ---")
        family_desc = input("If you want, briefly describe your situation (optional): ")
        stay_length_choice = ask_mc(
            "How long can you afford to stay there?",
            ["1–3 weeks", "2–5 months", "1 year or longer"]
        )
        contribute_choice = ask_mc(
            "Do you contribute to rent, food or utilities?",
            ["Yes", "No"]
        )
        perm_plan_choice = ask_mc(
            "Do you have a plan for permanent housing?",
            ["Yes", "No"]
        )
        on_lease_choice = ask_mc(
            "Are you on the lease?",
            ["Yes", "No"]
        )

        answers.update({
            "family_description": family_desc,
            "family_stay_length": stay_length_choice,
            "family_contribute": (contribute_choice == 1),
            "family_perm_plan": (perm_plan_choice == 1),
            "family_on_lease": (on_lease_choice == 1),
        })

    # ------------------ MATCHING ------------------

    housing_data = load_housing_data()
    top_matches = match_top_agencies(housing_data, answers, top_n=3)

    print("\n=== Top 3 Suggested Housing Options ===")
    for rank, (score, agency, reasons) in enumerate(top_matches, start=1):
        print(f"\n#{rank}: {agency.get('Organization', 'Unknown')}")
        print(f"   Score: {score}")
        print(f"   Phone: {agency.get('Phone', 'N/A')}")
        print(f"   Address: {agency.get('Address', 'N/A')}")
        print(f"   Rent range: ${agency.get('Min_Rent', 'N/A')} – ${agency.get('Max_Rent', 'N/A')}")
        print(f"   Bedrooms: {agency.get('Bedrooms', 'N/A')}")
        print(f"   Pet friendly: {agency.get('Pet_Friendly', 'Unknown')}")
        print(f"   Notes: {agency.get('Notes', '')}")
        print("   Why this matched:")
        for r in reasons:
            print(f"    - {r}")

    # ------------------ SAVE RESULTS TO CSV ------------------

    with open(csv_filename, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)

        writer.writerow(["User Information"])
        writer.writerow(["Name", name])
        writer.writerow(["Email", email])
        writer.writerow([])

        writer.writerow(["Survey Answers"])
        for key, value in answers.items():
            writer.writerow([key, value])
        writer.writerow([])

        writer.writerow(["Top 3 Housing Matches"])
        writer.writerow([
            "Rank", "Organization", "Score", "Phone", "Address",
            "Rent Range", "Bedrooms", "Pet Friendly", "Why it matched"
        ])

        for rank, (score, agency, reasons) in enumerate(top_matches, start=1):
            writer.writerow([
                rank,
                agency.get("Organization", "Unknown"),
                score,
                agency.get("Phone", "N/A"),
                agency.get("Address", "N/A"),
                f"{agency.get('Min_Rent', 'N/A')} - {agency.get('Max_Rent', 'N/A')}",
                agency.get("Bedrooms", "N/A"),
                agency.get("Pet_Friendly", "Unknown"),
                "; ".join(reasons)
            ])

    print(f"\nSaved results to CSV file: {csv_filename}")
    print("\n(Scoring is approximate. You can tune rent ranges, tags, and weights in the script.)")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting.")
        sys.exit(0)
