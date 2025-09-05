import argparse
import numpy as np
from tqdm import tqdm
from pos_tool import read_pos

# something like this will work
# but you need to add padding to the voxel grid
# to prevent out of bounds errors
# and then you need to remove the padding when you get the densities

def compute_density(points, R, D):
    """Compute density using voxel-based approach with resolution R and radius D."""
    # Quantize points to R resolution
    quantized_points = np.floor(points / R).astype(int)
    
    # subtract minimum x,y,z from all points
    min_point = np.min(quantized_points, axis=0)
    quantized_points -= min_point
    
    # get range of x,y,z using max
    x_range = np.max(quantized_points[:, 0])
    y_range = np.max(quantized_points[:, 1])
    z_range = np.max(quantized_points[:, 2])
    
    voxels_counts = np.zeros((x_range, y_range, z_range), dtype=int)
    
    # increment counts for each point
    i,j,k = quantized_points.T
    # Calculate all possible offsets within radius D/R
    max_offset = int(np.ceil(D / R))
    for dx in range(-max_offset, max_offset + 1):
        for dy in range(-max_offset, max_offset + 1):
            for dz in range(-max_offset, max_offset + 1):
                # Check if within spherical radius
                if dx*dx + dy*dy + dz*dz <= (D/R)**2:
                    # Update voxel counts for all points with this offset
                    voxels_counts[i+dx, j+dy, k+dz] += 1
                    
    # get densities for each point
    densities = voxels_counts[i,j,k]
    
    return densities

def main():
    parser = argparse.ArgumentParser(description='Compute density for each point in POS file')
    parser.add_argument('pos_file', help='Path to the POS file')
    parser.add_argument('--R', type=float, default=1.0, help='Voxel resolution in nm')
    parser.add_argument('--D', type=float, default=5.0, help='Search radius in nm')
    parser.add_argument('--output', default='density_results.npy', help='Output file name')
    args = parser.parse_args()
    
    # Load POS file
    pos_data = read_pos(args.pos_file)
    if pos_data is None:
        return
    
    # Extract coordinates and mass-charge ratio
    points = pos_data[:, :3]  # x,y,z coordinates
    mass_charge = pos_data[:, 3]  # mass-charge ratio
    
    # Compute densities
    densities = compute_density(points, args.R, args.D)
    
    # Combine all data into Nx5 array
    results = np.column_stack((points, mass_charge, densities))
    
    # Save results
    np.save(args.output, results)
    print(f"Results saved to {args.output}")

if __name__ == '__main__':
    main() 