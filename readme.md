# uap-materials

Data available [here}(https://drive.google.com/drive/folders/1xM-jIvX5aEARkMNToYQINXg2owX1HroB)

## Setup

### Backend

1. Ensure Python 3.x is installed
2. Install required Python packages:
   ```bash
   cd backend && pip install -r requirements.txt
   ```

### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

## Usage

1. Convert POS files to XYZ format using the backend script:
   ```bash
   cd backend && python pos_tool.py data/input.pos --xyz
   ```

2. Open the web viewer and drag-and-drop the generated XYZ file to view the 3D structure.