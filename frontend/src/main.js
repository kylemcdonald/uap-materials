import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Element colors (based on CPK coloring scheme)
const elementColors = {
    'H': 0xFFFFFF, 'He': 0xFFC0CB, 'Li': 0x800080, 'Be': 0x00FF00, 'B': 0xFFA500,
    'C': 0x808080, 'N': 0x0000FF, 'O': 0xFF0000, 'F': 0xFFFF00, 'Ne': 0xFF1493,
    'Na': 0x0000FF, 'Mg': 0x00FF00, 'Al': 0x808080, 'Si': 0xDAA520, 'P': 0xFFA500,
    'S': 0xFFFF00, 'Cl': 0x00FF00, 'Ar': 0xFF1493, 'K': 0xFF1493, 'Ca': 0x808080,
    'Fe': 0xFFA500, 'Cu': 0xFFA500, 'Ag': 0xC0C0C0, 'Au': 0xFFD700
};

let scene, camera, renderer, controls, points;
const dropZone = document.getElementById('dropZone');

// Initialize Three.js scene
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    camera.position.z = 5;
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Parse XYZ file content
function parseXYZ(content) {
    const lines = content.split('\n');
    const numAtoms = parseInt(lines[0]);
    const positions = [];
    const colors = [];
    
    for (let i = 2; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 4) {
            const element = parts[0];
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            
            positions.push(x, y, z);
            const color = elementColors[element] || 0x808080;
            colors.push(
                ((color >> 16) & 255) / 255,
                ((color >> 8) & 255) / 255,
                (color & 255) / 255
            );
        }
    }

    console.log(`Loaded ${positions.length / 3} points from XYZ file`);
    return { positions, colors };
}

// Create point cloud from XYZ data
function createPointCloud(positions, colors) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        sizeAttenuation: true
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);

    // Center the point cloud
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    points.position.sub(center);

    // Adjust camera to fit the point cloud
    const box = new THREE.Box3().setFromObject(points);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.z = maxDim * 2;
}

// Handle file drop
function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    dropZone.style.display = 'none';
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.xyz')) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const content = event.target.result;
            const { positions, colors } = parseXYZ(content);
            
            if (points) {
                scene.remove(points);
            }
            createPointCloud(positions, colors);
        };
        reader.readAsText(file);
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Event listeners
window.addEventListener('resize', onWindowResize);
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
window.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});
window.addEventListener('drop', handleDrop);

// Initialize and start animation
init();
animate(); 