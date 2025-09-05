import periodictable
import json
import os

def build_isotopic_table():
    """Build a table of isotopic masses and their corresponding elements using periodictable.
    Includes all isotopes with abundance >= 1% and marks the most abundant ones."""
    isotopic_ratios = {}  # For most abundant isotopes only
    isotopic_ratios_with_numbers = {}  # For all isotopes
    most_abundant_isotopes = {}  # Track most abundant isotope for each element
    
    # First pass: find most abundant isotope for each element
    for element in periodictable.elements:
        if element.symbol == 'n':  # Skip neutrons
            continue
            
        # Find the most abundant isotope
        most_abundant = None
        max_abundance = -1
        
        for isotope in element:
            if isotope.mass is not None and isotope.abundance is not None:
                if isotope.abundance > max_abundance:
                    max_abundance = isotope.abundance
                    most_abundant = isotope
        
        # Store the most abundant isotope
        if most_abundant is not None:
            mass = float(most_abundant.mass)
            symbol = element.symbol
            most_abundant_isotopes[symbol] = mass
    
    # Second pass: add all isotopes with abundance >= 1%
    for element in periodictable.elements:
        if element.symbol == 'n':  # Skip neutrons
            continue
            
        for isotope in element:
            if isotope.mass is not None and isotope.abundance is not None and isotope.abundance >= 1:
                mass = float(isotope.mass)
                symbol = element.symbol
                # Calculate mass number (nearest integer to the mass)
                mass_number = round(mass)
                isotope_label = f"{symbol}{mass_number}"
                
                # Add to isotopic_ratios_with_numbers with abundance info
                isotopic_ratios_with_numbers[str(mass)] = {
                    'symbol': symbol,
                    'label': isotope_label,
                    'abundance': isotope.abundance,
                    'is_most_abundant': mass == most_abundant_isotopes.get(symbol)
                }
                
                # Add to isotopic_ratios only if it's the most abundant
                if mass == most_abundant_isotopes.get(symbol):
                    isotopic_ratios[str(mass)] = symbol
    
    return isotopic_ratios, isotopic_ratios_with_numbers

def save_isotopic_tables():
    """Build and save the isotopic tables to JSON files."""
    isotopic_ratios, isotopic_ratios_with_numbers = build_isotopic_table()
    
    # Create reference directory if it doesn't exist
    os.makedirs(os.path.join(os.path.dirname(__file__), 'reference'), exist_ok=True)
    
    # Save both tables
    with open(os.path.join(os.path.dirname(__file__), 'reference', 'isotopic_ratios.json'), 'w') as f:
        json.dump(isotopic_ratios, f, indent=2)
    
    with open(os.path.join(os.path.dirname(__file__), 'reference', 'isotopic_ratios_with_numbers.json'), 'w') as f:
        json.dump(isotopic_ratios_with_numbers, f, indent=2)

if __name__ == "__main__":
    save_isotopic_tables() 