import argparse
import numpy as np
import time
import os
from umap import UMAP
import matplotlib.pyplot as plt
from pos_tool import read_pos
from tqdm import tqdm
from sklearn.cluster import DBSCAN
from matplotlib.patches import Ellipse
import matplotlib.transforms as transforms
import json
from scipy.spatial.distance import cosine

def create_mass_range_matrices(pos_data, voxel_size=10.0):
    """Create 3D count matrices for each mass range.
    
    Args:
        pos_data: NumPy array containing the ion data
        voxel_size: Size of voxels in nm
        
    Returns:
        tuple: (flattened_matrices, mass_ranges)
    """
    # Zero-reference the positions
    min_pos = np.min(pos_data[:, :3], axis=0)
    zero_ref_pos = pos_data[:, :3] - min_pos
    
    # Quantize positions
    quantized_pos = np.floor(zero_ref_pos / voxel_size).astype(int)
    
    # Get maximum dimensions for the 3D matrix
    max_dims = np.max(quantized_pos, axis=0) + 1
    
    # Get mass ranges (0 to max mass in 1-unit increments)
    max_mass = 120
    mass_ranges = np.arange(0, max_mass)
    
    # Initialize list to store flattened matrices
    flattened_matrices = []
    
    # Process each mass range
    for mass in tqdm(mass_ranges, desc="Processing mass ranges"):
        # Create mask for points in this mass range
        mask = (pos_data[:, 3] >= mass) & (pos_data[:, 3] < mass + 1)
        points_in_range = quantized_pos[mask]
        
        # Create 3D count matrix
        count_matrix = np.zeros(max_dims, dtype=np.float32)
        
        # Count points in each voxel
        for point in points_in_range:
            count_matrix[tuple(point)] += 1
        
        # Normalize the matrix
        if np.max(count_matrix) > 0:
            count_matrix = count_matrix / np.max(count_matrix)
        
        # Flatten the matrix
        flattened = count_matrix.flatten()
        flattened_matrices.append(flattened)
    
    return np.array(flattened_matrices), mass_ranges

def visualize_mass_range_umap(embedding, mass_ranges, output_file, cluster_labels=None):
    """Visualize UMAP embedding of mass ranges.
    
    Args:
        embedding: UMAP embedding of mass ranges
        mass_ranges: Array of mass range values
        output_file: Path to save the visualization
        cluster_labels: Array of cluster labels (optional)
    """
    plt.figure(figsize=(12, 10))
    
    # Create scatter plot
    scatter = plt.scatter(embedding[:, 0], embedding[:, 1], 
                         c=mass_ranges,
                         cmap='viridis',
                         alpha=0.6)
    
    # Add colorbar
    plt.colorbar(scatter, label='Mass Range')
    
    if cluster_labels is not None:
        unique_labels = set(cluster_labels)
        n_clusters = len([l for l in unique_labels if l != -1])
        if n_clusters > 1:
            for label in unique_labels:
                if label == -1:
                    continue  # Noise
                cluster_points = embedding[cluster_labels == label]
                if len(cluster_points) < 2:
                    continue
                cov = np.cov(cluster_points, rowvar=False)
                mean = np.mean(cluster_points, axis=0)
                vals, vecs = np.linalg.eigh(cov)
                order = vals.argsort()[::-1]
                vals, vecs = vals[order], vecs[:, order]
                theta = np.degrees(np.arctan2(*vecs[:,0][::-1]))
                width, height = 2 * np.sqrt(vals)
                ellipse = Ellipse(xy=mean, width=width, height=height, angle=theta, edgecolor='red', fc='None', lw=2)
                plt.gca().add_patch(ellipse)
    
    plt.title('UMAP Embedding of Mass Ranges\nColors represent mass values')
    plt.xlabel('UMAP 1')
    plt.ylabel('UMAP 2')
    
    # Save figure
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    plt.close()

def compute_similarity_matrix(flattened_matrices):
    """Compute cosine similarity matrix between all mass range matrices.
    
    Args:
        flattened_matrices: Array of flattened count matrices for each mass range
        
    Returns:
        numpy.ndarray: Similarity matrix
    """
    n_matrices = len(flattened_matrices)
    similarity_matrix = np.zeros((n_matrices, n_matrices))
    
    for i in tqdm(range(n_matrices), desc="Computing similarities"):
        for j in range(i, n_matrices):
            # Compute cosine similarity (1 - cosine distance)
            similarity = 1 - cosine(flattened_matrices[i], flattened_matrices[j])
            similarity_matrix[i, j] = similarity
            similarity_matrix[j, i] = similarity  # Matrix is symmetric
            
    return similarity_matrix

def visualize_similarity_matrix(similarity_matrix, mass_ranges, output_file):
    """Visualize the similarity matrix between mass ranges.
    
    Args:
        similarity_matrix: Matrix of similarities between mass ranges
        mass_ranges: Array of mass range values
        output_file: Path to save the visualization
    """
    plt.figure(figsize=(12, 10))
    
    # Create heatmap
    plt.imshow(similarity_matrix, cmap='viridis', aspect='auto')
    plt.colorbar(label='Cosine Similarity')
    
    # Set axis labels
    plt.xlabel('Mass Range')
    plt.ylabel('Mass Range')
    
    # Set title
    plt.title('Similarity Matrix Between Mass Ranges')
    
    # Save figure
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    plt.close()

def main():
    parser = argparse.ArgumentParser(description='Analyze POS file using mass-range based approach with UMAP')
    parser.add_argument('pos_file', help='Path to the POS file')
    parser.add_argument('--voxel-size', type=float, default=10.0, help='Size of voxels in nm (default: 10.0)')
    parser.add_argument('--output-dir', default='mass_range_analysis', help='Output directory for results')
    parser.add_argument('--cluster', action='store_true', help='Run clustering on UMAP results and draw ellipses')
    args = parser.parse_args()
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Start timing
    start_time = time.time()
    
    # Load POS file
    print("Loading POS file...")
    pos_data = read_pos(args.pos_file)
    if pos_data is None:
        return
    
    load_time = time.time() - start_time
    print(f"Loaded {len(pos_data)} ions in {load_time:.2f} seconds")
    
    # Create mass range matrices
    print("\nCreating mass range matrices...")
    matrix_start = time.time()
    flattened_matrices, mass_ranges = create_mass_range_matrices(pos_data, args.voxel_size)
    matrix_time = time.time() - matrix_start
    print(f"Created {len(mass_ranges)} mass range matrices in {matrix_time:.2f} seconds")
    
    # Compute and visualize similarity matrix
    print("\nComputing similarity matrix...")
    similarity_matrix = compute_similarity_matrix(flattened_matrices)
    base_filename = os.path.splitext(os.path.basename(args.pos_file))[0]
    similarity_output = os.path.join(args.output_dir, f'{base_filename}_similarity_matrix.png')
    visualize_similarity_matrix(similarity_matrix, mass_ranges, similarity_output)
    print(f"Similarity matrix visualization saved to {similarity_output}")
    
    # Perform UMAP
    print("\nPerforming UMAP...")
    umap_start = time.time()
    reducer = UMAP(n_components=2, random_state=42)
    embedding = reducer.fit_transform(flattened_matrices)
    umap_time = time.time() - umap_start
    print(f"Completed UMAP in {umap_time:.2f} seconds")
    
    # Visualize results
    print("\nCreating visualization...")
    output_file = os.path.join(args.output_dir, f'{base_filename}_mass_range_umap.png')
    if args.cluster:
        # Use DBSCAN for clustering
        db = DBSCAN(eps=1.2, min_samples=3).fit(embedding)
        cluster_labels = db.labels_
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        print(f"Found {n_clusters} clusters")
        
        # Export cluster labels to JSON
        cluster_data = {
            'mass_ranges': mass_ranges.tolist(),
            'cluster_labels': cluster_labels.tolist()
        }
        cluster_file = os.path.join(args.output_dir, f'{base_filename}_cluster_labels.json')
        with open(cluster_file, 'w') as f:
            json.dump(cluster_data, f)
        print(f"Cluster labels exported to {cluster_file}")
        
        visualize_mass_range_umap(embedding, mass_ranges, output_file, cluster_labels=cluster_labels)
    else:
        visualize_mass_range_umap(embedding, mass_ranges, output_file)
    
    # Print total time
    total_time = time.time() - start_time
    print(f"\nTotal processing time: {total_time:.2f} seconds")

if __name__ == "__main__":
    main() 