import struct
import sys
import os
import time
import numpy as np
import matplotlib.pyplot as plt
import argparse
import json
from matplotlib import patheffects

# Create necessary directories
CACHE_DIR = 'cache'
XYZ_DIR = 'xyz'
MASS_SPECTRUM_DIR = 'mass_spectrum'
DATA_DIR = 'data'

for directory in [CACHE_DIR, XYZ_DIR, MASS_SPECTRUM_DIR, DATA_DIR]:
    os.makedirs(directory, exist_ok=True)

# Load isotopic ratios from JSON files
with open(os.path.join('reference', 'isotopic_ratios.json'), 'r') as f:
    isotopic_ratios = json.load(f)
    # Convert string keys to float
    isotopic_ratios = {float(k): v for k, v in isotopic_ratios.items()}

with open(os.path.join('reference', 'isotopic_ratios_with_numbers.json'), 'r') as f:
    isotopic_ratios_with_numbers = json.load(f)
    # Convert string keys to float
    isotopic_ratios_with_numbers = {float(k): v for k, v in isotopic_ratios_with_numbers.items()}

# Load element categories
with open(os.path.join('reference', 'element_categories.json'), 'r') as f:
    element_categories = json.load(f)

# Create element to category mapping
element_to_category = {}
for category, data in element_categories.items():
    for element in data['elements']:
        element_to_category[element] = category

# Create element to color mapping
element_to_color = {}
for category, data in element_categories.items():
    for element in data['elements']:
        element_to_color[element] = data['color']

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

def generate_mass_spectrum(pos_data, min_mass=0, max_mass=125, mass_resolution=0.01, output_file=None):
    """Generate a histogram of mass-to-charge ratios.
    
    Args:
        pos_data: NumPy array containing the ion data
        min_mass: Minimum mass-to-charge ratio to include in the spectrum
        max_mass: Maximum mass-to-charge ratio to include in the spectrum
        mass_resolution: Resolution of the mass spectrum in Da (default: 0.01)
        output_file: Optional path to save the histogram data as .npy file
        
    Returns:
        tuple: (bin_centers, hist) containing the mass-to-charge ratios and their counts
    """
    # Calculate number of bins based on resolution
    num_bins = int((max_mass - min_mass) / mass_resolution)
    
    # Create bin edges that are centered on integer values
    bin_edges = np.arange(min_mass - mass_resolution/2, max_mass + mass_resolution/2, mass_resolution)
    
    # Compute histogram
    hist, bin_edges = np.histogram(pos_data[:, 3], bins=bin_edges, density=False)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    
    # Save histogram data as numpy array if output_file is provided
    if output_file:
        histogram_data = np.column_stack((bin_centers, hist))
        histogram_file = os.path.join(MASS_SPECTRUM_DIR, os.path.splitext(os.path.basename(output_file))[0] + '_data.npy')
        np.save(histogram_file, histogram_data)
        
        # Also save as CSV file
        csv_file = os.path.join(MASS_SPECTRUM_DIR, os.path.splitext(os.path.basename(output_file))[0] + '_data.csv')
        import csv
        with open(csv_file, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Mass_Charge_Ratio', 'Count'])
            for mass, count in zip(bin_centers, hist):
                writer.writerow([round(mass, 2), count])
        print(f"Mass spectrum data saved to {csv_file}")
    
    return bin_centers, hist

def to_superscript(n):
    """Convert a number to superscript Unicode characters."""
    superscript_map = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
    }
    return ''.join(superscript_map.get(d, d) for d in str(n))

def visualize_mass_spectrum(bin_centers, hist, output_file, elements_in_image=None, peak_threshold=0.1):
    """Visualize a mass spectrum and save as PNG.
    
    Args:
        bin_centers: Array of mass-to-charge ratios
        hist: Array of counts for each mass-to-charge ratio
        output_file: Path to save the PNG file
        elements_in_image: Set of element symbols to include in the visualization (deprecated)
        peak_threshold: Threshold for peak detection as a fraction (default: 0.1)
    """
    plt.style.use('default')
    plt.figure(figsize=(12, 2))
    
    # Check for cluster labels
    base_filename = os.path.splitext(os.path.basename(output_file))[0]
    cluster_file = os.path.join('mass_range_analysis', f'{base_filename}_cluster_labels.json')
    cluster_colors = None
    
    if os.path.exists(cluster_file):
        try:
            with open(cluster_file, 'r') as f:
                cluster_data = json.load(f)
                mass_ranges = np.array(cluster_data['mass_ranges'])
                cluster_labels = np.array(cluster_data['cluster_labels'])
                
                # Create a mapping from mass ranges to cluster labels
                mass_to_cluster = dict(zip(mass_ranges, cluster_labels))
                
                # Create colors for each bin based on its mass range
                cluster_colors = []
                for mass in bin_centers:
                    # Find the closest mass range
                    mass_range = np.floor(mass)
                    if mass_range in mass_to_cluster:
                        cluster = mass_to_cluster[mass_range]
                        # Use different colors for different clusters
                        if cluster == -1:  # Noise points
                            cluster_colors.append('gray')
                        else:
                            # Use a different color for each cluster
                            cluster_colors.append(plt.cm.tab10(cluster % 10))
                    else:
                        cluster_colors.append('gray')
        except Exception as e:
            print(f"Warning: Could not load cluster labels: {e}")
            cluster_colors = None
    
    # Plot histogram with logarithmic scale
    if cluster_colors:
        # Plot each bar with its cluster color
        for i in range(len(bin_centers)):
            plt.bar(bin_centers[i], hist[i], width=np.diff(bin_centers)[0], 
                   alpha=0.4, color=cluster_colors[i])
    else:
        plt.bar(bin_centers, hist, width=np.diff(bin_centers)[0], alpha=0.4, color='black')
    
    plt.yscale('log')
    
    # First pass: identify elements that meet the threshold criteria (using most abundant isotopes)
    detected_elements = set()
    for mass, element in isotopic_ratios.items():
        if bin_centers[0] <= mass <= bin_centers[-1]:  # Only consider elements within our plot range
            # Find the closest bin center and its height
            bin_idx = np.argmin(np.abs(bin_centers - mass))
            bin_height = hist[bin_idx]
            
            # Calculate the range of bins to compare against (±1 unit)
            average_range_units = 0.2
            exclude_range_units = 0.1
            
            mass_resolution = bin_centers[1] - bin_centers[0]
            range_bins = int(average_range_units / mass_resolution)
            
            # Get the range of indices to compare against
            start_idx = max(0, bin_idx - range_bins)
            end_idx = min(len(hist), bin_idx + range_bins + 1)
            
            # Create a mask to exclude the current bin and 10 bins on either side
            mask = np.ones(end_idx - start_idx, dtype=bool)
            exclude_range = int(exclude_range_units / mass_resolution)
            mask[max(0, bin_idx - start_idx - exclude_range):min(end_idx - start_idx, bin_idx - start_idx + exclude_range + 1)] = False
            
            # Calculate the average height of surrounding bins
            surrounding_avg = np.mean(hist[start_idx:end_idx][mask])
            
            # Only add if the current bin is significantly higher than surrounding bins
            if bin_height > (1 + peak_threshold) * surrounding_avg:
                detected_elements.add(element)
    
    # Second pass: check for all isotopes of detected elements
    for mass, isotope_data in isotopic_ratios_with_numbers.items():
        # Get element symbol from the isotope data
        element = isotope_data['symbol']
        if element in detected_elements and bin_centers[0] <= mass <= bin_centers[-1]:
            # Find the closest bin center and its height
            bin_idx = np.argmin(np.abs(bin_centers - mass))
            bin_height = hist[bin_idx]
            
            # Calculate the range of bins to compare against
            average_range_units = 0.2
            exclude_range_units = 0.1
            
            mass_resolution = bin_centers[1] - bin_centers[0]
            range_bins = int(average_range_units / mass_resolution)
            
            # Get the range of indices to compare against
            start_idx = max(0, bin_idx - range_bins)
            end_idx = min(len(hist), bin_idx + range_bins + 1)
            
            # Create a mask to exclude the current bin and nearby bins
            mask = np.ones(end_idx - start_idx, dtype=bool)
            exclude_range = int(exclude_range_units / mass_resolution)
            mask[max(0, bin_idx - start_idx - exclude_range):min(end_idx - start_idx, bin_idx - start_idx + exclude_range + 1)] = False
            
            # Calculate the average height of surrounding bins
            surrounding_avg = np.mean(hist[start_idx:end_idx][mask])
            
            # Only draw if the current bin is significantly higher than surrounding bins
            if bin_height > (1 + peak_threshold) * surrounding_avg:
                # Get color for the element
                color = element_to_color.get(element, 'red')  # Default to red if element not found
                
                # Draw a line segment at the element mass with matching bin height
                plt.plot([mass, mass], [0, bin_height], color=color, linewidth=1)
                
                # Add text at the top of the histogram at this position
                # Use a smaller font size for isotopes
                fontsize = 8
                # Get isotope number from label
                isotope_number = isotope_data['label'].replace(element, '')
                # Convert isotope number to superscript
                superscript_number = to_superscript(isotope_number)
                # Format label with superscript isotope number
                label = f"{superscript_number}{element}" if isotope_number else element
                plt.text(mass, hist[np.argmin(np.abs(bin_centers - mass))], label, 
                        ha='center', va='bottom',
                        fontsize=fontsize, color='black',
                        path_effects=[patheffects.withStroke(linewidth=2, foreground='white')])
    
    plt.xlim(bin_centers[0], bin_centers[-1])
    plt.xlabel('Mass-charge ratio', color='black')
    plt.ylabel('Count', color='black')
    plt.tick_params(colors='black')
    
    # Remove top and right spines
    plt.gca().spines['top'].set_visible(False)
    plt.gca().spines['right'].set_visible(False)
    
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()

def visualize_zoomed_peaks(bin_centers, hist, output_file):
    """Create a grid of zoomed plots showing the 10 largest peaks in the mass spectrum.
    
    Args:
        bin_centers: Array of mass-to-charge ratios
        hist: Array of counts for each mass-to-charge ratio
        output_file: Path to save the PNG file
    """
    # Find the 10 largest peaks, excluding regions near previously selected peaks
    peaks = []
    excluded_regions = []
    
    while len(peaks) < 10:
        # Find the highest point not in excluded regions
        valid_indices = np.ones(len(hist), dtype=bool)
        for start, end in excluded_regions:
            valid_indices[start:end] = False
        
        if not np.any(valid_indices):
            break
            
        peak_idx = np.argmax(hist * valid_indices)
        peak_mass = bin_centers[peak_idx]
        peak_height = hist[peak_idx]
        
        # Add peak to list
        peaks.append((peak_idx, peak_mass, peak_height))
        
        # Mark region around peak as excluded
        mass_resolution = bin_centers[1] - bin_centers[0]
        exclude_range = int(0.1 / mass_resolution)  # +/- 0.1 unit
        start_idx = max(0, peak_idx - exclude_range)
        end_idx = min(len(hist), peak_idx + exclude_range + 1)
        excluded_regions.append((start_idx, end_idx))
    
    # Sort peaks by mass
    peaks.sort(key=lambda x: x[1])
    
    # Create figure with 5x2 grid
    fig, axes = plt.subplots(2, 5, figsize=(20, 8))
    axes = axes.flatten()
    
    for i, (peak_idx, peak_mass, peak_height) in enumerate(peaks):
        if i >= len(axes):
            break
            
        ax = axes[i]
        
        # Calculate range to show (peak mass +/- 0.1 unit)
        mass_resolution = bin_centers[1] - bin_centers[0]
        range_bins = int(0.1 / mass_resolution)
        start_idx = max(0, peak_idx - range_bins)
        end_idx = min(len(hist), peak_idx + range_bins + 1)
        
        # Plot the zoomed region
        ax.bar(bin_centers[start_idx:end_idx], hist[start_idx:end_idx], 
               width=mass_resolution, alpha=0.4, color='black')
        
        # Check if we have a label for this peak
        for mass, isotope_data in isotopic_ratios_with_numbers.items():
            if abs(mass - peak_mass) < mass_resolution:
                element = isotope_data['symbol']
                color = element_to_color.get(element, 'red')
                
                # Draw vertical line at the element mass
                ax.plot([mass, mass], [0, peak_height], color=color, linewidth=1)
                
                # Add label
                isotope_number = isotope_data['label'].replace(element, '')
                superscript_number = to_superscript(isotope_number)
                label = f"{superscript_number}{element}" if isotope_number else element
                ax.text(mass, peak_height, label,
                       ha='center', va='bottom',
                       fontsize=8, color='black',
                       path_effects=[patheffects.withStroke(linewidth=2, foreground='white')])
        
        ax.set_xlim(peak_mass - 0.1, peak_mass + 0.1)
        ax.set_yscale('log')
        ax.set_title(f'Peak at {peak_mass:.2f} Da')
        ax.tick_params(colors='black')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()

def create_mass_spectrum(pos_data, output_file, min_mass=0, max_mass=125, mass_resolution=0.01, peak_threshold=0.1):
    """Create a histogram of mass-to-charge ratios and save as PNG.
    
    Args:
        pos_data: NumPy array containing the ion data
        output_file: Path to save the PNG file
        min_mass: Minimum mass-to-charge ratio to include in the spectrum
        max_mass: Maximum mass-to-charge ratio to include in the spectrum
        mass_resolution: Resolution of the mass spectrum in Da (default: 0.01)
        peak_threshold: Threshold for peak detection as a fraction (default: 0.1)
    """
    bin_centers, hist = generate_mass_spectrum(pos_data, min_mass, max_mass, mass_resolution, output_file)
    visualize_mass_spectrum(bin_centers, hist, output_file, peak_threshold=peak_threshold)
    
    # Create zoomed peak plots
    zoomed_output_file = os.path.splitext(output_file)[0] + '_zoomed_peaks.png'
    visualize_zoomed_peaks(bin_centers, hist, zoomed_output_file)

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

def render_pos_views(pos_data, output_dir, filename_base):
    """Render POS file in different views.
    
    Args:
        pos_data: NumPy array containing the ion data
        output_dir: Directory to save the rendered images
        filename_base: Base filename for the output images
    """
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Extract coordinates and mass-charge ratios
    x = pos_data[:, 0]
    y = pos_data[:, 1]
    z = pos_data[:, 2]
    mass_charge = pos_data[:, 3]
    
    # Create colormap for mass-charge ratios (0 to 80)
    cmap = plt.cm.gist_rainbow
    norm = plt.Normalize(0, 80)
    colors = cmap(norm(np.clip(mass_charge, 0, 80)))
    
    # 1. Side view (orthographic) - swapped x and z axes
    plt.figure(figsize=(20, 5))  # Adjusted for 2048x512 aspect ratio
    plt.scatter(z, x, c=colors, s=1, alpha=0.1)
    plt.axis('equal')
    plt.xlabel('Z (nm)', color='black')
    plt.ylabel('X (nm)', color='black')
    plt.tick_params(colors='black')
    plt.gca().spines['top'].set_visible(False)
    plt.gca().spines['right'].set_visible(False)
    plt.savefig(os.path.join(output_dir, f'{filename_base}_side.png'), dpi=102.4, bbox_inches='tight', facecolor='white')
    plt.close()
    
    # 2. Grid of z-slices (5x5 subplots)
    fig, axes = plt.subplots(5, 5, figsize=(20, 20))
    z_min, z_max = np.min(z), np.max(z)
    z_targets = np.linspace(z_min, z_max, 26)  # 25 slices + 1 endpoint
    
    # Find indices closest to each z target
    slice_indices = []
    for z_target in z_targets:
        idx = np.argmin(np.abs(z - z_target))
        slice_indices.append(idx)
    
    # Sort indices to ensure they're in order
    slice_indices = np.sort(slice_indices)
    
    for i in range(5):
        for j in range(5):
            idx = i * 5 + j
            if idx < 25:
                start_idx = slice_indices[idx]
                end_idx = slice_indices[idx + 1]
                mask = slice(start_idx, end_idx)
                axes[i, j].scatter(x[mask], y[mask], c=colors[mask], s=1, alpha=0.1)
                axes[i, j].set_axis_off()
                axes[i, j].set_aspect('equal')
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, f'{filename_base}_z_slices.png'), dpi=102.4, bbox_inches='tight', facecolor='white')
    plt.close()

if __name__ == "__main__":
    script_start_time = time.time()
    print("Starting POS to XYZ conversion...")
    
    # Set up argument parser
    parser = argparse.ArgumentParser(description='Convert APT POS files to XYZ format and generate mass spectrum.')
    parser.add_argument('pos_file', help='Path to the POS file to convert')
    parser.add_argument('-n', '--num-atoms', type=int, help='Number of atoms to process (optional)')
    parser.add_argument('--xyz', action='store_true', help='Save XYZ file')
    parser.add_argument('--min-mass', type=float, default=0, help='Minimum mass-to-charge ratio for spectrum (default: 0)')
    parser.add_argument('--max-mass', type=float, default=125, help='Maximum mass-to-charge ratio for spectrum (default: 125)')
    parser.add_argument('--mass-resolution', type=float, default=0.01, help='Mass spectrum resolution in Da (default: 0.01)')
    parser.add_argument('--peak-threshold', type=float, default=0.5, help='Threshold for peak detection as a fraction (default: 0.1)')
    parser.add_argument('--render', action='store_true', help='Render POS file in different views')
    parser.add_argument('--output-dir', default='renders', help='Directory to save rendered images (default: renders)')
    
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
        create_mass_spectrum(pos_data, spectrum_file, args.min_mass, args.max_mass, args.mass_resolution, args.peak_threshold)
        print(f"Mass spectrum saved to {spectrum_file}")
        
        # Render views if requested
        if args.render:
            print("\nRendering views...")
            render_start_time = time.time()
            filename_base = os.path.splitext(os.path.basename(args.pos_file))[0]
            render_pos_views(pos_data, args.output_dir, filename_base)
            render_elapsed = time.time() - render_start_time
            print(f"Views rendered in {render_elapsed:.2f} seconds")
            print(f"Rendered views saved to {args.output_dir}")
        
        # Print bounding box
        print_bounding_box(pos_data)
        
        total_elapsed = time.time() - script_start_time
        print(f"\nTotal processing time: {total_elapsed:.2f} seconds")