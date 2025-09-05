import os
import glob
import time
import subprocess

def process_pos_files(data_dir='data'):
    """Process all .POS files in the specified directory.
    
    Args:
        data_dir: Path to directory containing .POS files
    """
    # Create data directory if it doesn't exist
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs('voxel_analysis', exist_ok=True)
    
    # Find all .POS files
    pos_files = glob.glob(os.path.join(data_dir, '*.POS'))
    
    if not pos_files:
        print(f"No .POS files found in {data_dir}")
        return
    
    print(f"Found {len(pos_files)} .POS files to process")
    
    # Process each file
    for pos_file in pos_files:
        print(f"\nProcessing {os.path.basename(pos_file)}...")
        start_time = time.time()
        
        # Create mass spectrum using pos_tool.py
        subprocess.run([
            'python', 'pos_tool.py',
            pos_file,
            '--render'
        ])
        
        # Perform voxel analysis using voxel_analysis.py
        print("\nPerforming voxel analysis...")
        voxel_start = time.time()
        
        output_file = os.path.join('voxel_analysis', os.path.splitext(os.path.basename(pos_file))[0] + '_umap.png')
        subprocess.run([
            'python', 'voxel_analysis.py',
            pos_file
        ])
        
        voxel_elapsed = time.time() - voxel_start
        print(f"Completed voxel analysis in {voxel_elapsed:.2f} seconds")
        
        elapsed = time.time() - start_time
        print(f"Completed processing {os.path.basename(pos_file)} in {elapsed:.2f} seconds")

if __name__ == "__main__":
    process_pos_files() 