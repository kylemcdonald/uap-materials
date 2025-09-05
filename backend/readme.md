# UAP Materials

This repository contains data and analysis for 8 material samples.

The samples have .POS atomic probe tomography data, and also analysis files (mass spectrum, 3d renders) and also additional imagery like SEM files.

## .POS file reference

Sample 1
data/Sample 1- POS file.POS

Sample 2
(no .POS file)

Sample 3
data/Sample 3 -POS file.POS

Sample A
data/2166bb75-7ff6-4c85-bf2d-564431f0b089.POS

Sample B
data/e14f067b-4c6f-4c34-8e25-ac1e4a217c57.POS

Sample C
data/12d8ba7d-b728-4362-a879-558857c7b4d2.POS

Sample D
data/86a2fa56-8593-4856-bd42-b73716197abf.POS

Sample E
data/499e563f-0c0c-4c6f-bc08-b8e76f59c31b.POS

## Imagery

`renders/` contains <filename>_side.png and <filename>_z_slices.png for each .POS file

`images/` contains SEM and some microscope imagery for the different samples. Some samples (like 1 and 3) are missing imagery.

`mass_range_analysis/` has diagrams in the format <filename>_mass_range_umap.png and <filename>_similarity_matrix.png.

`mass_spectrum/` has diagrams in the format <filename>_mass_spectrum.png, ignore the .npy files they are just cache.