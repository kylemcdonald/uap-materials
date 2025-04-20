import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as d3 from 'd3';

let scene, camera, renderer, controls, points;
const dropZone = document.getElementById('dropZone');
let globalChargeMassRatios = []; // Store charge-mass ratios for histogram
let rotationSpeed = 0.5; // Default rotation speed in radians per second
let totalPoints = 0; // Total number of points in the loaded file
let minIndex = 0; // Minimum index to display
let indexRange = 1000000; // Number of points to display

// Shader code
const defaultVertexShader = `
    attribute float chargeMassRatio;
    attribute float index;
    varying vec3 vColor;
    uniform float size;
    uniform float minThreshold;
    uniform float maxThreshold;
    uniform float minIndex;
    uniform float maxIndex;
    
    // HSL to RGB conversion
    vec3 hsl2rgb(vec3 hsl) {
        vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
    }
    
    void main() {
        if (chargeMassRatio >= minThreshold && chargeMassRatio <= maxThreshold && 
            index >= minIndex && index < maxIndex) {
            vColor = vec3(1.0);
        } else {
            vColor = vec3(0.0);
        }
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const defaultFragmentShader = `
    varying vec3 vColor;
    
    void main() {
        if (vColor.r == 0.0) {
            discard;
        }
        gl_FragColor = vec4(vColor, 1.0);
    }
`;

// Initialize Three.js scene
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
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

    // Create threshold slider
    createThresholdSlider();

    // Create index range slider
    createIndexRangeSlider();

    camera.position.z = 5;
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Convert HSL to RGB
function hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = function hue2rgb(p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return [r, g, b];
}

// Handle file drop
function handleDrop(e) {
    console.log('Drop event triggered');
    e.preventDefault();
    dropZone.classList.remove('dragover');
    dropZone.style.display = 'none';
    
    const file = e.dataTransfer.files[0];
    console.log('Dropped file:', file ? file.name : 'No file');
    
    if (file && file.name.toLowerCase().endsWith('.pos')) {
        console.log('Starting to read POS file');
        const reader = new FileReader();
        reader.onload = function(event) {
            console.log('File read complete, content length:', event.target.result.byteLength);
            const buffer = event.target.result;
            const { positions, chargeMassRatios, indices } = parsePOS(buffer);
            
            if (points) {
                console.log('Removing existing point cloud');
                scene.remove(points);
            }
            console.log('Creating new point cloud');
            createPointCloud(positions, chargeMassRatios, indices);
        };
        reader.onerror = function(error) {
            console.error('Error reading file:', error);
        };
        reader.readAsArrayBuffer(file);
    } else {
        console.log('Invalid file type or no file dropped');
    }
}

// Parse POS file content
function parsePOS(buffer) {
    console.log('Starting to parse POS content');
    const dataView = new DataView(buffer);
    const numPoints = buffer.byteLength / 16; // 4 floats * 4 bytes each
    console.log('Total points in file:', numPoints);
    
    // Update total points for the index sliders
    totalPoints = numPoints;
    
    // Update the sliders if the function exists
    if (window.updateIndexSliders) {
        window.updateIndexSliders();
    }
    
    const positions = [];
    const chargeMassRatios = []; // Local array for charge-mass ratios
    const indices = []; // Array to store indices
    
    const MAX_POINTS = 16_000_000;
    const numPointsToLoad = Math.min(numPoints, MAX_POINTS);
    
    for (let i = 0; i < numPointsToLoad; i++) {
        const offset = i * 16;
        const x = dataView.getFloat32(offset, false); // false for big-endian
        const y = dataView.getFloat32(offset + 4, false);
        const z = dataView.getFloat32(offset + 8, false);
        const chargeMassRatio = dataView.getFloat32(offset + 12, false);
        
        positions.push(x, y, z);
        chargeMassRatios.push(chargeMassRatio);
        indices.push(i); // Add the index
    }

    console.log(`Successfully parsed ${positions.length / 3} points`);
    console.log('First few positions:', positions.slice(0, 9));
    
    // Update the global array for histogram
    globalChargeMassRatios = chargeMassRatios;
    createHistogram();
    return { positions, chargeMassRatios, indices };
}

// Create histogram using D3
function createHistogram() {
    // Remove existing histogram if any
    d3.select('#histogram').remove();
    
    // Create container for histogram
    const histogramDiv = d3.select('body')
        .append('div')
        .attr('id', 'histogram')
        .style('position', 'fixed')
        .style('bottom', '20px')
        .style('left', '20px')
        .style('right', '20px')
        .style('height', '200px')
        .style('background', 'rgba(0,0,0, 0.25)')
        .style('border-radius', '5px')
        .style('z-index', '1000');
        
    // Add filter controls to histogram
    const filterControls = histogramDiv.append('div')
        .attr('id', 'histogramControls')
        .style('position', 'absolute')
        .style('top', '5px')
        .style('right', '10px')
        .style('z-index', '1001')
        .style('display', 'flex')
        .style('gap', '10px');
    
    // Add scale toggle button
    filterControls.append('button')
        .attr('id', 'scaleToggle')
        .text('Toggle Scale (Log/Linear)')
        .style('padding', '3px 8px')
        .style('border-radius', '3px')
        .style('background', 'rgba(255,255,255,0.8)')
        .style('border', '1px solid #ccc')
        .style('cursor', 'pointer')
        .style('font-size', '12px')
        .on('click', toggleHistogramScale);
    
    // Add zoom reset button
    filterControls.append('button')
        .attr('id', 'resetZoom')
        .text('Reset Zoom')
        .style('padding', '3px 8px')
        .style('border-radius', '3px')
        .style('background', 'rgba(255,255,255,0.8)')
        .style('border', '1px solid #ccc')
        .style('cursor', 'pointer')
        .style('font-size', '12px')
        .on('click', resetHistogramZoom);
        
    // We no longer need the threshold toggle button as we'll use double-click instead

    // Create SVG with proper dimensions and padding
    const margin = {top: 10, right: 10, bottom: 30, left: 40};
    const width = window.innerWidth - margin.left - margin.right - 40; // 40px for left and right padding
    const height = 200 - margin.top - margin.bottom;
    
    const svg = histogramDiv.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)
        .attr('id', 'histogramGroup');
        
    // Store current scale type in a data attribute
    svg.attr('data-scale', 'log');

    // Check if we have data to display
    if (globalChargeMassRatios.length === 0) {
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2)
            .attr('text-anchor', 'middle')
            .text('No data available');
        return;
    }

    // Create histogram data
    const histogram = d3.histogram()
        .domain([0, 120])
        .thresholds(1200); // Increased number of thresholds to 1200

    const bins = histogram(globalChargeMassRatios);

    // Create scales
    const x = d3.scaleLinear()
        .domain([0, 120])
        .range([0, width]);

    // Use logarithmic scale for y-axis
    const y = d3.scaleLog()
        .domain([1, d3.max(bins, d => d.length) || 1]) // Use 1 as minimum to avoid log(0)
        .range([height, 0]);

    // Add bars
    svg.selectAll('rect')
        .data(bins)
        .enter()
        .append('rect')
        .attr('x', d => x(d.x0))
        .attr('y', d => y(d.length))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0))) // Removed the -1 to eliminate gaps
        .attr('height', d => height - y(d.length))
        .style('fill', 'white');
        // .style('opacity', 1.0);

    // Add highlight for selected range
    const minSlider = document.querySelector('input[type="range"]');
    const rangeSlider = document.querySelectorAll('input[type="range"]')[1];
    
    const minValue = parseFloat(minSlider.value);
    const rangeValue = parseFloat(rangeSlider.value);
    
    // Add highlight rectangle
    svg.append('rect')
        .attr('x', x(minValue))
        .attr('y', 0)
        .attr('width', x(minValue + rangeValue) - x(minValue))
        .attr('height', height)
        .style('fill', 'rgba(255, 255, 0, 0.3)')
        .style('pointer-events', 'none')
        .attr('id', 'rangeHighlight');

    // Add axes with numbers
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5))
        .style('font-size', '10px')
        .style('color', 'white');

    svg.append('g')
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1e")))
        .style('font-size', '10px')
        .style('color', 'white');
        
    // Add brush for area selection
    const brush = d3.brushX()
        .extent([[0, 0], [width, height]])
        .on("end", brushed);
        
    svg.append("g")
        .attr("class", "brush")
        .call(brush);
        
    // Add global threshold line (horizontal) - initially hidden
    const thresholdLine = svg.append('line')
        .attr('id', 'globalThresholdLine')
        .attr('x1', 0)
        .attr('y1', height) // Start at the bottom
        .attr('x2', width)
        .attr('y2', height)
        .style('stroke', 'red')
        .style('stroke-width', 2)
        .style('stroke-dasharray', '5,5')
        .style('cursor', 'ns-resize') // Vertical cursor for horizontal line
        .style('display', 'none'); // Initially hidden
        
    // Add threshold value label
    const thresholdLabel = svg.append('text')
        .attr('id', 'thresholdLabel')
        .attr('x', 10) // Position at left side
        .attr('y', height - 5)
        .attr('text-anchor', 'start')
        .style('fill', 'red')
        .style('font-size', '12px')
        .style('font-weight', 'bold')
        .style('display', 'none') // Initially hidden
        .text('Threshold: 0');
        
    // Add double-click event listener to create/show threshold line
    svg.on('dblclick', function(event) {
        // Get the y position of the click
        const [_, yPos] = d3.pointer(event);
        
        // Get the current y scale
        const currentScale = svg.attr('data-scale');
        const maxBinHeight = d3.max(svg.selectAll('rect').data(), d => d.length) || 1;
        
        let y;
        if (currentScale === 'log') {
            y = d3.scaleLog()
                .domain([1, maxBinHeight])
                .range([height, 0]);
        } else {
            y = d3.scaleLinear()
                .domain([0, maxBinHeight])
                .range([height, 0]);
        }
        
        // Convert y position to threshold value
        const thresholdValue = Math.round(y.invert(yPos));
        
        // Update the global threshold slider
        const globalThresholdSlider = document.querySelector('#controls input[type="range"]');
        globalThresholdSlider.value = thresholdValue;
        globalThresholdSlider.dispatchEvent(new Event('input'));
        
        // Show and update the threshold line
        thresholdLine.style('display', null);
        thresholdLabel.style('display', null);
        
        // Update the threshold line position
        thresholdLine
            .attr('y1', yPos)
            .attr('y2', yPos);
            
        // Update the threshold label
        thresholdLabel
            .attr('y', yPos - 5)
            .text(`Threshold: ${thresholdValue}`);
            
        // Filter the histogram bins
        filterHistogramByThreshold(thresholdValue);
    });
        
    // Brush event handler
    function brushed(event) {
        if (!event.selection) return; // Ignore brush-by-zoom
        
        // Convert the brush selection from pixels to data values
        const [x0, x1] = event.selection.map(x.invert);
        
        // Update the threshold sliders
        const minSlider = document.querySelector('input[type="range"]');
        const rangeSlider = document.querySelectorAll('input[type="range"]')[1];
        
        // Set min threshold to the start of the selection
        minSlider.value = Math.max(0, Math.floor(x0));
        minSlider.dispatchEvent(new Event('input'));
        
        // Set range to the width of the selection
        const selectionWidth = Math.ceil(x1) - Math.floor(x0);
        rangeSlider.value = Math.min(200, selectionWidth);
        rangeSlider.dispatchEvent(new Event('input'));
    }
}

// Create threshold slider
function createThresholdSlider() {
    // Create container for controls
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.style.position = 'fixed';
    controlsDiv.style.top = '20px';
    controlsDiv.style.left = '20px';
    controlsDiv.style.background = 'rgba(255, 255, 255, 0.9)';
    controlsDiv.style.padding = '10px';
    controlsDiv.style.borderRadius = '5px';
    controlsDiv.style.border = '1px solid #ccc';
    document.body.appendChild(controlsDiv);
    
    // Create global threshold label
    const globalThresholdLabel = document.createElement('label');
    globalThresholdLabel.textContent = 'Global Threshold: ';
    globalThresholdLabel.style.display = 'block';
    globalThresholdLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(globalThresholdLabel);
    
    // Create global threshold slider
    const globalThresholdSlider = document.createElement('input');
    globalThresholdSlider.type = 'range';
    globalThresholdSlider.min = '0';
    globalThresholdSlider.max = '100000';
    globalThresholdSlider.value = '0';
    globalThresholdSlider.step = '1';
    globalThresholdSlider.style.width = '200px';
    controlsDiv.appendChild(globalThresholdSlider);
    
    // Create global threshold value display
    const globalThresholdDisplay = document.createElement('span');
    globalThresholdDisplay.textContent = '0';
    globalThresholdDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(globalThresholdDisplay);
    
    // Add a divider
    const divider = document.createElement('hr');
    divider.style.margin = '15px 0';
    controlsDiv.appendChild(divider);

    // Create min label
    const minLabel = document.createElement('label');
    minLabel.textContent = 'Min Threshold: ';
    minLabel.style.display = 'block';
    minLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(minLabel);

    // Create min slider
    const minSlider = document.createElement('input');
    minSlider.type = 'range';
    minSlider.min = '0';
    minSlider.max = '200';
    minSlider.value = '0';
    minSlider.step = '1';
    minSlider.style.width = '200px';
    controlsDiv.appendChild(minSlider);

    // Create min value display
    const minValueDisplay = document.createElement('span');
    minValueDisplay.textContent = '0';
    minValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(minValueDisplay);

    // Create range label
    const rangeLabel = document.createElement('label');
    rangeLabel.textContent = 'Range: ';
    rangeLabel.style.display = 'block';
    rangeLabel.style.marginTop = '10px';
    rangeLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(rangeLabel);

    // Create range slider
    const rangeSlider = document.createElement('input');
    rangeSlider.type = 'range';
    rangeSlider.min = '0';
    rangeSlider.max = '200';
    rangeSlider.value = '200';
    rangeSlider.step = '1';
    rangeSlider.style.width = '200px';
    controlsDiv.appendChild(rangeSlider);

    // Create range value display
    const rangeValueDisplay = document.createElement('span');
    rangeValueDisplay.textContent = '200';
    rangeValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(rangeValueDisplay);

    // Create rotation speed label
    const rotationLabel = document.createElement('label');
    rotationLabel.textContent = 'Rotation Speed: ';
    rotationLabel.style.display = 'block';
    rotationLabel.style.marginTop = '10px';
    rotationLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(rotationLabel);

    // Create rotation speed slider
    const rotationSlider = document.createElement('input');
    rotationSlider.type = 'range';
    rotationSlider.min = '0';
    rotationSlider.max = '2';
    rotationSlider.value = '0.5';
    rotationSlider.step = '0.1';
    rotationSlider.style.width = '200px';
    controlsDiv.appendChild(rotationSlider);

    // Create rotation speed value display
    const rotationValueDisplay = document.createElement('span');
    rotationValueDisplay.textContent = '0.5';
    rotationValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(rotationValueDisplay);

    // Add event listeners
    minSlider.addEventListener('input', function() {
        const minValue = parseFloat(this.value);
        const rangeValue = parseFloat(rangeSlider.value);
        minValueDisplay.textContent = minValue;
        
        // Ensure min + range doesn't exceed 200
        if (minValue + rangeValue > 200) {
            rangeSlider.value = 200 - minValue;
            rangeValueDisplay.textContent = 200 - minValue;
        }
        
        // Update the threshold uniforms if points exist
        if (points && points.material.uniforms) {
            points.material.uniforms.minThreshold.value = minValue;
            points.material.uniforms.maxThreshold.value = minValue + parseFloat(rangeSlider.value);
        }
        
        // Update histogram highlight
        updateHistogramHighlight();
    });

    rangeSlider.addEventListener('input', function() {
        const rangeValue = parseFloat(this.value);
        const minValue = parseFloat(minSlider.value);
        rangeValueDisplay.textContent = rangeValue;
        
        // Ensure min + range doesn't exceed 200
        if (minValue + rangeValue > 200) {
            minSlider.value = 200 - rangeValue;
            minValueDisplay.textContent = 200 - rangeValue;
        }
        
        // Update the threshold uniforms if points exist
        if (points && points.material.uniforms) {
            points.material.uniforms.minThreshold.value = parseFloat(minSlider.value);
            points.material.uniforms.maxThreshold.value = parseFloat(minSlider.value) + rangeValue;
        }
        
        // Update histogram highlight
        updateHistogramHighlight();
    });

    // Add global threshold event listener
    globalThresholdSlider.addEventListener('input', function() {
        const thresholdValue = parseInt(this.value);
        globalThresholdDisplay.textContent = thresholdValue;
        
        // Update the global threshold line
        updateGlobalThresholdLine(thresholdValue);
        
        // Update the histogram to filter bins
        filterHistogramByThreshold(thresholdValue);
    });
    
    // Add rotation speed event listener
    rotationSlider.addEventListener('input', function() {
        rotationSpeed = parseFloat(this.value);
        rotationValueDisplay.textContent = rotationSpeed.toFixed(1);
    });
}

// Function to update histogram highlight
function updateHistogramHighlight() {
    const minSlider = document.querySelector('input[type="range"]');
    const rangeSlider = document.querySelectorAll('input[type="range"]')[1];
    
    const minValue = parseFloat(minSlider.value);
    const rangeValue = parseFloat(rangeSlider.value);
    
    // Get the histogram SVG
    const histogramDiv = d3.select('#histogram');
    if (histogramDiv.empty()) return;
    
    const svg = histogramDiv.select('svg g');
    const width = svg.node().parentNode.getBoundingClientRect().width - 50; // Approximate width
    
    // Create x scale
    const x = d3.scaleLinear()
        .domain([0, 120])
        .range([0, width]);
    
    // Update or create highlight
    let highlight = svg.select('#rangeHighlight');
    
    if (highlight.empty()) {
        highlight = svg.append('rect')
            .attr('id', 'rangeHighlight')
            .style('fill', 'rgba(255, 255, 0, 0.3)')
            .style('pointer-events', 'none');
    }
    
    highlight
        .attr('x', x(minValue))
        .attr('width', x(minValue + rangeValue) - x(minValue))
        .attr('height', svg.node().getBoundingClientRect().height);
        
    // Make sure the brush doesn't interfere with our highlight
    svg.select('.brush').raise();
}

// Create point cloud from POS data
function createPointCloud(positions, chargeMassRatios, indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    // Set the charge-mass ratio attribute directly from the array
    geometry.setAttribute('chargeMassRatio', new THREE.Float32BufferAttribute(chargeMassRatios, 1));
    
    // Set the index attribute
    geometry.setAttribute('index', new THREE.Float32BufferAttribute(indices, 1));

    // Create custom shader material
    const material = new THREE.ShaderMaterial({
        uniforms: {
            size: { value: 1.0 },
            minThreshold: { value: 0.0 },
            maxThreshold: { value: 200.0 },
            minIndex: { value: minIndex },
            maxIndex: { value: minIndex + indexRange }
        },
        vertexShader: defaultVertexShader,
        fragmentShader: defaultFragmentShader,
        transparent: true,
        vertexColors: false
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

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Rotate the point cloud around the z-axis
    if (points) {
        points.rotation.z += rotationSpeed * 0.01;
    }
    
    renderer.render(scene, camera);
}

// Event listeners
window.addEventListener('resize', onWindowResize);
window.addEventListener('dragover', (e) => {
    console.log('Drag over event');
    e.preventDefault();
    dropZone.classList.add('dragover');
});
window.addEventListener('dragleave', () => {
    console.log('Drag leave event');
    dropZone.classList.remove('dragover');
});
window.addEventListener('drop', handleDrop);

// Add resize event listener for histogram
window.addEventListener('resize', () => {
    if (globalChargeMassRatios.length > 0) {
        createHistogram();
    }
});

// Create index range slider
function createIndexRangeSlider() {
    // Create container for index controls
    const indexControlsDiv = document.createElement('div');
    indexControlsDiv.id = 'indexControls';
    indexControlsDiv.style.position = 'fixed';
    indexControlsDiv.style.top = '20px';
    indexControlsDiv.style.right = '20px';
    indexControlsDiv.style.background = 'rgba(255, 255, 255, 0.9)';
    indexControlsDiv.style.padding = '10px';
    indexControlsDiv.style.borderRadius = '5px';
    indexControlsDiv.style.border = '1px solid #ccc';
    indexControlsDiv.style.width = '250px';
    document.body.appendChild(indexControlsDiv);

    // Create title
    const titleDiv = document.createElement('div');
    titleDiv.textContent = 'Point Index Controls';
    titleDiv.style.fontWeight = 'bold';
    titleDiv.style.marginBottom = '10px';
    titleDiv.style.textAlign = 'center';
    indexControlsDiv.appendChild(titleDiv);

    // Create total points display
    const totalPointsDiv = document.createElement('div');
    totalPointsDiv.style.marginBottom = '15px';
    totalPointsDiv.style.textAlign = 'center';
    totalPointsDiv.style.fontSize = '0.9em';
    totalPointsDiv.textContent = 'Total Points: 0';
    indexControlsDiv.appendChild(totalPointsDiv);

    // Create min index label
    const minIndexLabel = document.createElement('label');
    minIndexLabel.textContent = 'Min Index: ';
    minIndexLabel.style.display = 'block';
    minIndexLabel.style.marginBottom = '5px';
    indexControlsDiv.appendChild(minIndexLabel);

    // Create min index slider
    const minIndexSlider = document.createElement('input');
    minIndexSlider.type = 'range';
    minIndexSlider.min = '0';
    minIndexSlider.max = '1000000';
    minIndexSlider.value = '0';
    minIndexSlider.step = '1000';
    minIndexSlider.style.width = '100%';
    indexControlsDiv.appendChild(minIndexSlider);

    // Create min index value display
    const minIndexValueDisplay = document.createElement('span');
    minIndexValueDisplay.textContent = '0';
    minIndexValueDisplay.style.marginLeft = '10px';
    indexControlsDiv.appendChild(minIndexValueDisplay);

    // Create index range label
    const indexRangeLabel = document.createElement('label');
    indexRangeLabel.textContent = 'Index Range: ';
    indexRangeLabel.style.display = 'block';
    indexRangeLabel.style.marginTop = '10px';
    indexRangeLabel.style.marginBottom = '5px';
    indexControlsDiv.appendChild(indexRangeLabel);

    // Create index range slider
    const indexRangeSlider = document.createElement('input');
    indexRangeSlider.type = 'range';
    indexRangeSlider.min = '1000';
    indexRangeSlider.max = '1000000';
    indexRangeSlider.value = '1000000';
    indexRangeSlider.step = '1000';
    indexRangeSlider.style.width = '100%';
    indexControlsDiv.appendChild(indexRangeSlider);

    // Create index range value display
    const indexRangeValueDisplay = document.createElement('span');
    indexRangeValueDisplay.textContent = '1000000';
    indexRangeValueDisplay.style.marginLeft = '10px';
    indexControlsDiv.appendChild(indexRangeValueDisplay);

    // Create display range info
    const rangeInfoDiv = document.createElement('div');
    rangeInfoDiv.style.marginTop = '10px';
    rangeInfoDiv.style.fontSize = '0.8em';
    rangeInfoDiv.style.textAlign = 'center';
    rangeInfoDiv.textContent = 'Displaying: 0 - 1,000,000';
    indexControlsDiv.appendChild(rangeInfoDiv);

    // Add event listeners
    minIndexSlider.addEventListener('input', function() {
        const newMinIndex = parseInt(this.value);
        const currentRange = parseInt(indexRangeSlider.value);
        minIndexValueDisplay.textContent = newMinIndex.toLocaleString();
        
        // Ensure min + range doesn't exceed total points
        if (newMinIndex + currentRange > totalPoints) {
            indexRangeSlider.value = totalPoints - newMinIndex;
            indexRangeValueDisplay.textContent = (totalPoints - newMinIndex).toLocaleString();
        }
        
        minIndex = newMinIndex;
        indexRange = parseInt(indexRangeSlider.value);
        
        // Update range info
        rangeInfoDiv.textContent = `Displaying: ${minIndex.toLocaleString()} - ${(minIndex + indexRange).toLocaleString()}`;
        
        // Update the point cloud if it exists
        if (points) {
            updatePointCloudIndexRange();
        }
    });

    indexRangeSlider.addEventListener('input', function() {
        const newRange = parseInt(this.value);
        const currentMin = parseInt(minIndexSlider.value);
        indexRangeValueDisplay.textContent = newRange.toLocaleString();
        
        // Ensure min + range doesn't exceed total points
        if (currentMin + newRange > totalPoints) {
            minIndexSlider.value = totalPoints - newRange;
            minIndexValueDisplay.textContent = (totalPoints - newRange).toLocaleString();
        }
        
        minIndex = parseInt(minIndexSlider.value);
        indexRange = newRange;
        
        // Update range info
        rangeInfoDiv.textContent = `Displaying: ${minIndex.toLocaleString()} - ${(minIndex + indexRange).toLocaleString()}`;
        
        // Update the point cloud if it exists
        if (points) {
            updatePointCloudIndexRange();
        }
    });
    
    // Function to update slider max values based on total points
    function updateSliderMaxValues() {
        // Update total points display
        totalPointsDiv.textContent = `Total Points: ${totalPoints.toLocaleString()}`;
        
        // Update min index slider max
        minIndexSlider.max = totalPoints.toString();
        
        // Update index range slider max
        const maxRange = totalPoints;
        indexRangeSlider.max = maxRange.toString();
        
        // If current values exceed new max, adjust them
        if (parseInt(minIndexSlider.value) > totalPoints) {
            minIndexSlider.value = '0';
            minIndexValueDisplay.textContent = '0';
            minIndex = 0;
        }
        
        if (parseInt(indexRangeSlider.value) > maxRange) {
            indexRangeSlider.value = maxRange.toString();
            indexRangeValueDisplay.textContent = maxRange.toLocaleString();
            indexRange = maxRange;
        }
        
        // Update range info
        rangeInfoDiv.textContent = `Displaying: ${minIndex.toLocaleString()} - ${(minIndex + indexRange).toLocaleString()}`;
        
        // Update the point cloud if it exists
        if (points) {
            updatePointCloudIndexRange();
        }
    }
    
    // Store the update function for later use
    window.updateIndexSliders = updateSliderMaxValues;
}

// Update point cloud based on index range
function updatePointCloudIndexRange() {
    if (!points) return;
    
    // Update the shader uniforms
    points.material.uniforms.minIndex.value = minIndex;
    points.material.uniforms.maxIndex.value = minIndex + indexRange;
}

// Function to toggle threshold line visibility
function toggleThresholdLine() {
    const line = d3.select('#globalThresholdLine');
    const label = d3.select('#thresholdLabel');
    const button = d3.select('#thresholdToggle');
    
    if (!line.empty() && !label.empty()) {
        const isVisible = line.style('display') !== 'none';
        
        if (isVisible) {
            line.style('display', 'none');
            label.style('display', 'none');
            button.text('Show Global Threshold');
            
            // Hide the count label
            d3.select('#countLabel').style('display', 'none');
            
            // Reset the bar colors
            d3.selectAll('rect').style('fill', 'white');
        } else {
            // Get the current global threshold value
            const globalThresholdSlider = document.querySelector('#controls input[type="range"]');
            const thresholdValue = parseInt(globalThresholdSlider.value);
            
            // Update the global threshold line
            updateGlobalThresholdLine(thresholdValue);
            
            // Update the histogram to filter bins
            filterHistogramByThreshold(thresholdValue);
            
            button.text('Hide Global Threshold');
        }
    }
}

// Drag handlers for threshold line
function dragStarted() {
    d3.select(this).raise().style('stroke', 'orange');
}

function dragged(event) {
    // Get the histogram SVG and create x scale
    const svg = d3.select('#histogramGroup');
    const width = svg.node().parentNode.getBoundingClientRect().width - 50;
    const x = d3.scaleLinear()
        .domain([0, 120])
        .range([0, width]);
    
    const xPos = Math.max(0, Math.min(width, event.x));
    const dataValue = x.invert(xPos);
    
    // Update line position
    d3.select(this)
        .attr('x1', xPos)
        .attr('x2', xPos);
        
    // Update label
    d3.select('#thresholdLabel')
        .attr('x', xPos)
        .text(dataValue.toFixed(1));
        
    // Update global threshold
    updateGlobalThreshold(dataValue);
}

function dragEnded() {
    d3.select(this).style('stroke', 'red');
}

// Function to update global threshold
function updateGlobalThreshold(value) {
    // Update the min threshold slider
    const minSlider = document.querySelector('input[type="range"]');
    minSlider.value = value;
    minSlider.dispatchEvent(new Event('input'));
}

// Function to toggle between log and linear scale
function toggleHistogramScale() {
    const svg = d3.select('#histogramGroup');
    
    if (!svg.empty()) {
        const currentScale = svg.attr('data-scale');
        const height = svg.node().getBoundingClientRect().height - 40; // Approximate height
        
        // Create histogram data
        const histogram = d3.histogram()
            .domain([0, 120])
            .thresholds(1200);
            
        const bins = histogram(globalChargeMassRatios);
        
        let y;
        if (currentScale === 'log') {
            // Switch to linear scale
            y = d3.scaleLinear()
                .domain([0, d3.max(bins, d => d.length) || 1])
                .range([height, 0]);
            svg.attr('data-scale', 'linear');
            d3.select('#scaleToggle').text('Toggle Scale (Linear/Log)');
        } else {
            // Switch to log scale
            y = d3.scaleLog()
                .domain([1, d3.max(bins, d => d.length) || 1])
                .range([height, 0]);
            svg.attr('data-scale', 'log');
            d3.select('#scaleToggle').text('Toggle Scale (Log/Linear)');
        }
        
        // Update the bars
        svg.selectAll('rect')
            .attr('y', d => y(Math.max(1, d.length)))
            .attr('height', d => height - y(Math.max(1, d.length)));
            
        // Update the y-axis
        svg.select('g:nth-child(5)').remove(); // Remove the y-axis
        svg.append('g')
            .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1e")))
            .style('font-size', '10px')
            .style('color', 'white');
    }
}

// Function to reset zoom to original domain
function resetHistogramZoom() {
    const svg = d3.select('#histogramGroup');
    
    if (!svg.empty()) {
        const width = svg.node().parentNode.getBoundingClientRect().width - 50;
        
        // Create x scale with original domain
        const x = d3.scaleLinear()
            .domain([0, 120])
            .range([0, width]);
            
        // Update the bars
        svg.selectAll('rect')
            .attr('x', d => x(d.x0))
            .attr('width', d => Math.max(0, x(d.x1) - x(d.x0)));
            
        // Update the x-axis
        svg.select('g:nth-child(4)').remove(); // Remove the x-axis
        const height = svg.node().getBoundingClientRect().height - 40;
        svg.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x).ticks(5))
            .style('font-size', '10px')
            .style('color', 'white');
            
        // Update the highlight rectangle
        updateHistogramHighlight();
        
        // Update the threshold line if visible
        const thresholdLine = d3.select('#globalThresholdLine');
        if (thresholdLine.style('display') !== 'none') {
            const minSlider = document.querySelector('input[type="range"]');
            const minValue = parseFloat(minSlider.value);
            const xPos = x(minValue);
            
            thresholdLine.attr('x1', xPos).attr('x2', xPos);
            d3.select('#thresholdLabel').attr('x', xPos);
        }
    }
}

// Function to update the global threshold line
function updateGlobalThresholdLine(thresholdValue) {
    const svg = d3.select('#histogramGroup');
    if (svg.empty()) return;
    
    const height = svg.node().getBoundingClientRect().height;
    const width = svg.node().parentNode.getBoundingClientRect().width - 50;
    
    // Get the current y scale
    const currentScale = svg.attr('data-scale');
    const maxBinHeight = d3.max(d3.selectAll('rect').data(), d => d.length) || 1;
    
    let y;
    if (currentScale === 'log') {
        y = d3.scaleLog()
            .domain([1, maxBinHeight])
            .range([height, 0]);
    } else {
        y = d3.scaleLinear()
            .domain([0, maxBinHeight])
            .range([height, 0]);
    }
    
    // Calculate y position for the threshold
    const yPos = y(thresholdValue);
    
    // Check if the threshold line exists
    let thresholdLine = svg.select('#globalThresholdLine');
    
    if (thresholdLine.empty()) {
        // Create the threshold line if it doesn't exist
        thresholdLine = svg.append('line')
            .attr('id', 'globalThresholdLine')
            .style('stroke', 'red')
            .style('stroke-width', 2)
            .style('stroke-dasharray', '5,5')
            .style('cursor', 'ns-resize');
    }
    
    // Update the threshold line position (horizontal line)
    thresholdLine
        .attr('x1', 0)
        .attr('y1', yPos)
        .attr('x2', width)
        .attr('y2', yPos)
        .style('display', null);
    
    // Update or create the threshold label
    let thresholdLabel = svg.select('#thresholdLabel');
    
    if (thresholdLabel.empty()) {
        thresholdLabel = svg.append('text')
            .attr('id', 'thresholdLabel')
            .style('fill', 'red')
            .style('font-size', '12px')
            .style('font-weight', 'bold')
            .attr('text-anchor', 'start');
    }
    
    thresholdLabel
        .attr('x', 10)
        .attr('y', yPos - 5)
        .text(`Threshold: ${thresholdValue}`)
        .style('display', null);
    
    // Make the threshold line draggable vertically
    thresholdLine.call(d3.drag()
        .on('start', function() {
            d3.select(this).raise().style('stroke', 'orange');
        })
        .on('drag', function(event) {
            const newY = Math.max(0, Math.min(height, event.y));
            const newThreshold = Math.round(y.invert(newY));
            
            // Update line position
            d3.select(this)
                .attr('y1', newY)
                .attr('y2', newY);
                
            // Update label
            thresholdLabel
                .attr('y', newY - 5)
                .text(`Threshold: ${newThreshold}`);
                
            // Update the global threshold slider
            const globalThresholdSlider = document.querySelector('#controls input[type="range"]');
            globalThresholdSlider.value = newThreshold;
            globalThresholdSlider.dispatchEvent(new Event('input'));
        })
        .on('end', function() {
            d3.select(this).style('stroke', 'red');
        }));
}

// Function to filter histogram bins based on threshold
function filterHistogramByThreshold(thresholdValue) {
    const svg = d3.select('#histogramGroup');
    if (svg.empty()) return;
    
    // Update all bars based on the threshold
    svg.selectAll('rect')
        .style('fill', d => d.length >= thresholdValue ? 'white' : 'rgba(100, 100, 100, 0.3)');
    
    // Count how many bins are above threshold
    const binsAboveThreshold = svg.selectAll('rect').filter(d => d.length >= thresholdValue).size();
    const totalBins = svg.selectAll('rect').size();
    
    // Add or update a count label
    let countLabel = svg.select('#countLabel');
    
    if (countLabel.empty()) {
        countLabel = svg.append('text')
            .attr('id', 'countLabel')
            .style('fill', 'white')
            .style('font-size', '12px')
            .attr('text-anchor', 'end');
    }
    
    const width = svg.node().parentNode.getBoundingClientRect().width - 50;
    
    countLabel
        .attr('x', width - 10)
        .attr('y', 15)
        .text(`Bins above threshold: ${binsAboveThreshold}/${totalBins}`);
}

// Initialize and start animation
console.log('Initializing Three.js scene');
init();
console.log('Starting animation loop');
animate();
