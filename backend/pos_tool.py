import struct
import sys
import os
import time
import numpy as np
import matplotlib.pyplot as plt
import argparse
from isotopic_ratios import isotopic_ratios, isotopic_ratios_with_numbers

# Create necessary directories
CACHE_DIR = 'cache'
XYZ_DIR = 'xyz'
MASS_SPECTRUM_DIR = 'mass_spectrum'
DATA_DIR = 'data'

for directory in [CACHE_DIR, XYZ_DIR, MASS_SPECTRUM_DIR, DATA_DIR]:
    os.makedirs(directory, exist_ok=True)

# Create a lookup table with scaled mass values
SCALE_FACTOR = 10
MAX_MASS = 300  # Maximum mass we expect to handle
lookup_table = [''] * (int(MAX_MASS * SCALE_FACTOR) + 1)

# Fill the lookup table
for mass, element in isotopic_ratios.items():
    idx = int(mass * SCALE_FACTOR)
    if idx < len(lookup_table):
        lookup_table[idx] = element

def da_to_elements(da_values):
    """Convert mass/charge ratios (Da) to element symbols using lookup table.
    
    Args:
        da_values: NumPy array containing mass/charge ratios in Da
        
    Returns:
        NumPy array of element symbols
    """
    # Create arrays of masses and elements from the lookup table
    masses = np.array(list(isotopic_ratios.keys()))
    elements = np.array(list(isotopic_ratios.values()))
    
    # Initialize result array with 'X'
    result = np.full_like(da_values, 'X', dtype=object)
    
    # For each Da value, find the closest mass
    for i, da in enumerate(da_values):
        if da > 0:  # Only process positive masses
            # Find the index of the closest mass
            idx = np.argmin(np.abs(masses - da))
            # If the mass difference is within 10% of the mass, use the element
            if abs(masses[idx] - da) <= 0.1 * da:
                result[i] = elements[idx]
    
    return result

def read_pos(filepath):
    """Loads an APT .pos file as a numpy array.

    Returns:
        numpy array with columns:
        x: Reconstructed x position
        y: Reconstructed y position
        z: Reconstructed z position
        Da: mass/charge ratio of ion
    """
    start_time = time.time()
    print(f"Reading POS file: {filepath}")
    
    # Create cache file path in cache directory
    filename = os.path.basename(filepath)
    cache_filepath = os.path.join(CACHE_DIR, os.path.splitext(filename)[0] + '.npy')
    
    # Check if cache exists and is newer than the POS file
    if os.path.exists(cache_filepath):
        pos_mtime = os.path.getmtime(filepath)
        cache_mtime = os.path.getmtime(cache_filepath)
        
        if cache_mtime > pos_mtime:
            print("Loading from cache...")
            pos = np.load(cache_filepath)
            elapsed = time.time() - start_time
            print(f"Cache load complete in {elapsed:.2f} seconds")
            return pos
    
    try:
        with open(filepath, 'rb') as f:
            # Read the entire file
            data = f.read()
            n = len(data) // 4  # Each record is 4 bytes (one float)
            
            print("Unpacking data...")
            # Unpack all data at once
            d = struct.unpack('>' + 'f' * n, data)
            
            # Create numpy array with the unpacked data
            pos = np.array([d[0::4], d[1::4], d[2::4], d[3::4]]).T
            
            # Save to cache
            print("Saving to cache...")
            np.save(cache_filepath, pos)
            
            elapsed = time.time() - start_time
            print(f"POS file read and cache complete in {elapsed:.2f} seconds")
            return pos
            
    except FileNotFoundError:
        print(f"Error: File not found at '{filepath}'")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None

def export_to_xyz(pos_data, output_file, num_atoms=None):
    """Export the data to XYZ format.
    
    Args:
        pos_data: NumPy array containing the ion data
        output_file: Path to the output XYZ file
        num_atoms: Number of atoms to export (if None, export all)
    """
    start_time = time.time()
    print(f"Converting to XYZ format: {output_file}")
    
    if num_atoms is not None:
        pos_data = pos_data[:num_atoms]
    
    # Convert all Da values to elements in a single pass
    print("Converting mass/charge ratios to elements...")
    element_start_time = time.time()
    elements = da_to_elements(pos_data[:, 3])  # Da is in the 4th column
    element_elapsed = time.time() - element_start_time
    print(f"Element conversion complete in {element_elapsed:.2f} seconds")
    
    # Write to XYZ file
    write_start_time = time.time()
    with open(output_file, 'w') as f:
        # Write number of atoms
        f.write(f"{len(pos_data)}\n")
        # Write comment line
        f.write("APT ion positions\n")
        # Write coordinates
        for i in range(len(pos_data)):
            f.write(f"{elements[i]} {pos_data[i,0]:.6f} {pos_data[i,1]:.6f} {pos_data[i,2]:.6f}\n")
    
    write_elapsed = time.time() - write_start_time
    total_elapsed = time.time() - start_time
    print(f"XYZ file writing complete in {write_elapsed:.2f} seconds")
    print(f"Total XYZ conversion complete in {total_elapsed:.2f} seconds")

def create_mass_spectrum(pos_data, output_file):
    """Create a histogram of mass-to-charge ratios and save as PNG.
    
    Args:
        pos_data: NumPy array containing the ion data
        output_file: Path to save the PNG file
    """
    plt.style.use('dark_background')
    plt.figure(figsize=(12, 2))
    
    # Pre-compute histogram
    element_min = 0
    element_max = 125
    element_range = element_max - element_min
    hist, bin_edges = np.histogram(pos_data[:, 3], bins=element_range*20, range=(element_min, element_max), density=False)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    
    # Save histogram data as numpy array
    histogram_data = np.column_stack((bin_centers, hist))
    histogram_file = os.path.join(MASS_SPECTRUM_DIR, os.path.splitext(os.path.basename(output_file))[0] + '_data.npy')
    np.save(histogram_file, histogram_data)
    
    # Plot histogram with logarithmic scale
    plt.bar(bin_centers, hist, width=np.diff(bin_edges), alpha=0.7, color='white')
    plt.yscale('log')
    
    # Elements identified in the image (ignoring compounds/radicals like OH, AlO, etc.)
    elements_in_image = {'N', 'Al', 'Mg', 'Si', 'Fe', 'B', 'C', 'O', 'P', 'Cl', 'Mn', 'Cu', 'Ga', 'Ru', 'Ca', 'Cr', 'Co', 'Ni', 'K'}

    # Filter the dictionary
    filtered_isotopic_ratios = {
        mass: (symbol, isotope)
        for mass, (symbol, isotope) in isotopic_ratios_with_numbers.items()
        if symbol in elements_in_image
    }
    
    # Add element labels with isotope numbers
    for mass, (element, isotope_label) in filtered_isotopic_ratios.items():
        if element_min <= mass <= element_max:  # Only consider elements within our plot range
            # Find the closest bin center
            bin_idx = np.argmin(np.abs(bin_centers - mass))
            # Add text at the top of the histogram at this position
            plt.text(mass, hist[bin_idx], isotope_label, 
                    ha='center', va='bottom',
                    fontsize=8, color='white')
    
    plt.xlim(element_min, element_max)
    plt.xlabel('Mass-to-Charge Ratio (Da)', color='white')
    plt.ylabel('Count (log scale)', color='white')
    plt.grid(True, alpha=0.3, color='white')
    plt.tick_params(colors='white')
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor='black')
    plt.close()

def print_bounding_box(pos_data):
    """Print the bounding box for x, y, and z coordinates.
    
    Args:
        pos_data: NumPy array containing the ion data
    """
    x_min, y_min, z_min = np.min(pos_data[:, :3], axis=0)
    x_max, y_max, z_max = np.max(pos_data[:, :3], axis=0)
    
    print("\nBounding Box:")
    print(f"X range: {x_min:.6f} to {x_max:.6f}")
    print(f"Y range: {y_min:.6f} to {y_max:.6f}")
    print(f"Z range: {z_min:.6f} to {z_max:.6f}")

if __name__ == "__main__":
    script_start_time = time.time()
    print("Starting POS to XYZ conversion...")
    
    # Set up argument parser
    parser = argparse.ArgumentParser(description='Convert APT POS files to XYZ format and generate mass spectrum.')
    parser.add_argument('pos_file', help='Path to the POS file to convert')
    parser.add_argument('-n', '--num-atoms', type=int, help='Number of atoms to process (optional)')
    parser.add_argument('--xyz', action='store_true', help='Save XYZ file')
    
    args = parser.parse_args()

    # Check if the file exists
    if not os.path.exists(args.pos_file):
        print(f"Error: File '{args.pos_file}' does not exist.")
        sys.exit(1)

    # Read the data
    pos_data = read_pos(args.pos_file)
    if pos_data is not None:
        print(f"Successfully loaded {len(pos_data)} ions.")
        
        if args.xyz:
            print("\nFirst 10 ions:")
            # Create a preview of the first 10 rows
            preview_data = pos_data[:10]
            preview_start_time = time.time()
            preview_elements = da_to_elements(preview_data[:, 3])
            preview_elapsed = time.time() - preview_start_time
            print(f"Preview element conversion complete in {preview_elapsed:.2f} seconds")
            
            # Print preview data
            for i in range(len(preview_data)):
                print(f"{preview_elements[i]} {preview_data[i,0]:.6f} {preview_data[i,1]:.6f} {preview_data[i,2]:.6f} {preview_data[i,3]:.6f}")
            
            # Export to XYZ
            filename = os.path.basename(args.pos_file)
            output_file = os.path.join(XYZ_DIR, os.path.splitext(filename)[0] + '.xyz')
            export_to_xyz(pos_data, output_file, args.num_atoms)
            print(f"\nExported to {output_file}")
        
        # Create mass spectrum
        filename = os.path.basename(args.pos_file)
        spectrum_file = os.path.join(MASS_SPECTRUM_DIR, os.path.splitext(filename)[0] + '_mass_spectrum.png')
        create_mass_spectrum(pos_data, spectrum_file)
        print(f"Mass spectrum saved to {spectrum_file}")
        
        # Print bounding box
        print_bounding_box(pos_data)
        
        total_elapsed = time.time() - script_start_time
        print(f"\nTotal processing time: {total_elapsed:.2f} seconds")