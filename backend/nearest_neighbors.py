import argparse
import numpy as np
import matplotlib.pyplot as plt
from scipy.spatial import cKDTree
from pos_tool import read_pos

def find_nearest_neighbors(points, query_points, radius):
    """Find all points within a given radius of each query point."""
    tree = cKDTree(points)
    neighbors = []
    distances = []
    
    for query_point in query_points:
        # Find all points within radius
        indices = tree.query_ball_point(query_point, radius)
        neighbors.append(indices)
        
        # Calculate distances to neighbors
        if len(indices) > 0:
            dist = np.sqrt(np.sum((points[indices] - query_point)**2, axis=1))
            distances.append(dist)
        else:
            distances.append(np.array([]))
    
    return neighbors, distances

def plot_neighbors(points, query_indices, neighbor_indices, distances, radius):
    """Create subplots showing query points and their neighbors with distance histograms."""
    fig = plt.figure(figsize=(15, 10))
    
    for idx, (query_idx, neighbors, dists) in enumerate(zip(query_indices, neighbor_indices, distances)):
        # Create two subplots for each point - one for neighbors, one for histogram
        ax_neighbors = plt.subplot(2, 5, idx + 1)
        ax_hist = plt.subplot(2, 5, idx + 6)
        
        query_point = points[query_idx]
        
        # Plot all points in gray
        ax_neighbors.scatter(points[:, 0], points[:, 1], c='gray', alpha=0.1, s=1)
        
        # Plot neighbors in blue
        neighbor_points = points[neighbors]
        ax_neighbors.scatter(neighbor_points[:, 0], neighbor_points[:, 1], c='blue', s=20)
        
        # Plot query point in red
        ax_neighbors.scatter(query_point[0], query_point[1], c='red', s=100)
        
        # Draw lines from query point to neighbors
        for neighbor in neighbors:
            neighbor_point = points[neighbor]
            ax_neighbors.plot([query_point[0], neighbor_point[0]], 
                       [query_point[1], neighbor_point[1]], 
                       'g-', alpha=0.3)
        
        # Set title and equal aspect ratio for neighbors plot
        ax_neighbors.set_title(f'Point {query_idx}')
        ax_neighbors.set_aspect('equal')
        
        # Set axis limits to show region of interest
        ax_neighbors.set_xlim(query_point[0] - radius*1.2, query_point[0] + radius*1.2)
        ax_neighbors.set_ylim(query_point[1] - radius*1.2, query_point[1] + radius*1.2)
        
        # Plot histogram of distances
        if len(dists) > 0:
            ax_hist.hist(dists, bins=10, range=(0, radius), color='blue', alpha=0.7)
            ax_hist.set_title(f'Distance Histogram')
            ax_hist.set_xlabel('Distance')
            ax_hist.set_ylabel('Count')
        else:
            ax_hist.text(0.5, 0.5, 'No neighbors found', 
                        horizontalalignment='center',
                        verticalalignment='center',
                        transform=ax_hist.transAxes)
    
    plt.tight_layout()
    plt.show()

def plot_distance_histogram(points, radius, num_targets=1000):
    """Create a histogram of distances to neighbors for multiple target particles."""
    # Select random target points
    np.random.seed(42)  # For reproducibility
    target_indices = np.random.choice(len(points), size=num_targets, replace=False)
    target_points = points[target_indices]
    
    # Find neighbors and distances
    neighbors, distances = find_nearest_neighbors(points, target_points, radius)
    
    # Flatten all distances into a single array
    all_distances = np.concatenate([d for d in distances if len(d) > 0])
    
    # Create histogram
    plt.figure(figsize=(10, 6))
    plt.hist(all_distances, bins=50, range=(0, radius), color='blue', alpha=0.7)
    plt.title(f'Distance Histogram for {num_targets} Target Particles')
    plt.xlabel('Distance')
    plt.ylabel('Count')
    plt.grid(True, alpha=0.3)
    plt.show()

def main():
    parser = argparse.ArgumentParser(description='Find nearest neighbors in POS file')
    parser.add_argument('pos_file', help='Path to the POS file')
    parser.add_argument('--radius', type=float, default=10.0, help='Radius to search for neighbors')
    args = parser.parse_args()
    
    # Load POS file
    pos_data = read_pos(args.pos_file)
    if pos_data is None:
        return
    
    # Extract x,y coordinates
    points = pos_data[:, :2]
    
    # Select 5 random points as query points
    np.random.seed(42)  # For reproducibility
    query_indices = np.random.choice(len(points), size=5, replace=False)
    query_points = points[query_indices]
    
    # Find neighbors and distances
    neighbors, distances = find_nearest_neighbors(points, query_points, args.radius)
    
    # Print results
    for idx, (query_idx, neighbor_indices, dists) in enumerate(zip(query_indices, neighbors, distances)):
        print(f"\nPoint {query_idx} at position {points[query_idx]}")
        print(f"Found {len(neighbor_indices)} neighbors within {args.radius} units:")
        # Only print first 5 neighbors
        for neighbor_idx in neighbor_indices[:5]:
            print(f"  Neighbor {neighbor_idx} at position {points[neighbor_idx]}")
        if len(neighbor_indices) > 5:
            print(f"  ... and {len(neighbor_indices) - 5} more neighbors")
    
    # Create visualization
    plot_neighbors(points, query_indices, neighbors, distances, args.radius)
    
    # Create additional histogram with 1000 target particles
    plot_distance_histogram(points, args.radius)

if __name__ == '__main__':
    main() 