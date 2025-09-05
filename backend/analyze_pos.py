import os
import glob
import hashlib
import struct

def get_file_info(filepath):
    """Get file size and calculate number of points in a POS file."""
    file_size = os.path.getsize(filepath)
    # Each point is 4 floats (x,y,z,mass) and each float is 4 bytes
    num_points = file_size // 16
    return file_size, num_points

def get_sha256(filepath):
    """Calculate SHA-256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def main():
    # Find all POS files in the data directory
    pos_files = glob.glob('data/*.POS')
    
    # Print LaTeX table header
    print("\\begin{table}[H]")
    print("\\centering")
    print("\\begin{tabular}{lrrr}")
    print("\\toprule")
    print("POS Filename & SHA-256 Hash & Points & File Size (bytes) \\\\")
    print("\\midrule")
    
    # Process each file
    for pos_file in pos_files:
        filename = os.path.basename(pos_file)
        file_size, num_points = get_file_info(pos_file)
        sha256 = get_sha256(pos_file)
        print(f"{filename} & {sha256} & {num_points:,} & {file_size:,} \\\\")
    
    # Print table footer
    print("\\bottomrule")
    print("\\end{tabular}")
    print("\\end{table}")

if __name__ == "__main__":
    main() 