import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import os
from isotopic_ratios import isotopic_ratios

def load_mass_spectra():
    """Load all mass spectrum .npy files from the mass_spectrum directory."""
    mass_spectrum_dir = 'mass_spectrum'
    spectra_files = [f for f in os.listdir(mass_spectrum_dir) if f.endswith('_data.npy')]
    
    if len(spectra_files) < 3:
        raise ValueError("Need at least 3 mass spectrum files to create a 3D visualization")
    
    # Load the first three files
    spectra = []
    filenames = []
    for file in spectra_files[:3]:
        file_path = os.path.join(mass_spectrum_dir, file)
        data = np.load(file_path)
        # The data is stored as (bin_centers, counts)
        counts = data[:, 1]  # We only need the counts
        
        # Normalize max
        counts /= np.max(counts)
            
        spectra.append(counts)
        filenames.append(file)
        print(f"First 5 values of {file} (normalized): {counts[:5]}")
    
    print(f"Total number of bins: {len(spectra[0])}")
    return np.array(spectra), filenames

def create_3d_point_cloud(spectra):
    """Create a 3D point cloud from three mass spectra."""
    # Get the number of bins (should be the same for all spectra)
    num_bins = len(spectra[0])
    
    # Create points where each point is (x,y,z) where:
    # x is the count from the first spectrum
    # y is the count from the second spectrum
    # z is the count from the third spectrum
    points = np.zeros((num_bins, 3))
    for i in range(num_bins):
        points[i] = [spectra[0][i], spectra[1][i], spectra[2][i]]
    
    print("First 5 point positions (x,y,z):")
    for i in range(5):
        print(f"Point {i}: {points[i]}")
    
    return points

def find_closest_element(da_value):
    """Find the closest element in the isotopic ratios dictionary."""
    closest_da = min(isotopic_ratios.keys(), key=lambda x: abs(x - da_value))
    return isotopic_ratios[closest_da]

def visualize_point_cloud(points, filenames):
    """Visualize the 3D point cloud."""
    fig = plt.figure(figsize=(10, 10))
    ax = fig.add_subplot(111, projection='3d')
    
    # Plot only points above threshold
    threshold = 0.01
    high_intensity_points = points[np.any(points > threshold, axis=1)]
    
    # Plot points
    scatter = ax.scatter(high_intensity_points[:, 0], high_intensity_points[:, 1], high_intensity_points[:, 2], 
                        c='b', marker='.', alpha=0.6)
    
    # Add labels for high-intensity points
    num_bins = len(points)
    da_per_bin = 125.0 / num_bins  # Assuming 2500 bins from 0 to 125 Da
    
    for i in range(num_bins):
        if any(points[i] > threshold):
            da_value = i * da_per_bin
            element = find_closest_element(da_value)
            ax.text(points[i, 0], points[i, 1], points[i, 2], 
                   f'{element}\n{da_value:.2f}Da', 
                   fontsize=8)
    
    # Set labels using first two characters of filenames
    ax.set_xlabel(f'{filenames[0][:2]} Counts')
    ax.set_ylabel(f'{filenames[1][:2]} Counts')
    ax.set_zlabel(f'{filenames[2][:2]} Counts')
    
    # # Set log scale for all axes
    # ax.set_xscale('log')
    # ax.set_yscale('log')
    # ax.set_zscale('log')
    
    # Set title
    plt.title('3D Point Cloud of Mass Spectra (High Intensity Points Only)')
    
    # Show the plot
    plt.show()

def main():
    try:
        # Load the mass spectra
        print("Loading mass spectra...")
        spectra, filenames = load_mass_spectra()
        
        # Create the point cloud
        print("Creating 3D point cloud...")
        points = create_3d_point_cloud(spectra)
        
        # Visualize the point cloud
        print("Visualizing point cloud...")
        visualize_point_cloud(points, filenames)
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main() 