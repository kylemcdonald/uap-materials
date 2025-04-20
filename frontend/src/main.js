import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as d3 from 'd3';

let scene, camera, renderer, controls, points;
const dropZone = document.getElementById('dropZone');
let globalChargeMassRatios = []; // Store charge-mass ratios for histogram
let globalPositions = []; // Store positions for filtered views
let globalIndices = []; // Store indices for filtered views
let rotationSpeed = 0.5; // Default rotation speed in radians per second
let totalPoints = 0; // Total number of points in the loaded file
let minIndex = 0; // Minimum index to display
let indexRange = 1000000; // Number of points to display
let selectedRanges = []; // Array to store selected charge-mass ratio ranges
let filteredPointClouds = []; // Array to store filtered point clouds
let isShiftPressed = false; // Track if shift key is pressed

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
    uniform int selectedRangesCount;
    uniform vec2 selectedRanges[20]; // Support up to 20 selected ranges (min, max)
    uniform vec3 selectedRangeColors[20]; // Colors for each range
    
    // HSL to RGB conversion
    vec3 hsl2rgb(vec3 hsl) {
        vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
    }
    
    bool isPointInSelectedRange(float cmr, out vec3 rangeColor) {
        for (int i = 0; i < 20; i++) {
            if (i >= selectedRangesCount) break;
            if (cmr >= selectedRanges[i].x && cmr <= selectedRanges[i].y) {
                rangeColor = selectedRangeColors[i];
                return true;
            }
        }
        return false;
    }
    
    void main() {
        bool isVisible = chargeMassRatio >= minThreshold && chargeMassRatio <= maxThreshold && 
                         index >= minIndex && index < maxIndex;
        
        if (isVisible) {
            vec3 rangeColor = vec3(1.0, 0.0, 0.0); // Default selection color is red
            if (isPointInSelectedRange(chargeMassRatio, rangeColor)) {
                // Selected points are highlighted with the range color
                vColor = rangeColor;
            } else {
                // Regular visible points are white
                vColor = vec3(1.0);
            }
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

        // No longer needed since we're selecting on the histogram

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

    // Create selection info panel
    createSelectionInfoPanel();

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
    
    // Store the data globally for filtered views
    globalPositions = positions;
    globalChargeMassRatios = chargeMassRatios;
    globalIndices = indices;
    
    // Create histogram
    createHistogram();
    
    // Clear any existing filtered point clouds
    clearFilteredPointClouds();
    
    return { positions, chargeMassRatios, indices };
}

// Function to clear all filtered point clouds
function clearFilteredPointClouds() {
    // Remove all filtered point clouds from the scene
    filteredPointClouds.forEach(cloud => {
        scene.remove(cloud);
    });
    
    // Clear the array
    filteredPointClouds = [];
}

// Function to create a filtered point cloud for a specific range
function createFilteredPointCloud(min, max, color) {
    if (!globalPositions.length || !globalChargeMassRatios.length) return null;
    
    // Filter points based on charge-mass ratio range
    const filteredPositions = [];
    const filteredIndices = [];
    
    for (let i = 0; i < globalChargeMassRatios.length; i++) {
        const cmr = globalChargeMassRatios[i];
        
        // Check if the point is within the range
        if (cmr >= min && cmr <= max) {
            // Add the position (x, y, z)
            filteredPositions.push(
                globalPositions[i*3],
                globalPositions[i*3+1],
                globalPositions[i*3+2]
            );
            
            // Add the index
            filteredIndices.push(globalIndices[i]);
        }
    }
    
    // If no points match, return null
    if (filteredPositions.length === 0) {
        console.log(`No points found in range ${min} - ${max}`);
        return null;
    }
    
    console.log(`Created filtered point cloud with ${filteredPositions.length / 3} points for range ${min} - ${max}`);
    
    // Create geometry for the filtered points
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(filteredPositions, 3));
    
    // Create material with the specified color
    const material = new THREE.PointsMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        size: 1.0,
        transparent: true
    });
    
    // Create the point cloud
    const filteredCloud = new THREE.Points(geometry, material);
    
    // Center the point cloud (use the same center as the main point cloud)
    if (points) {
        filteredCloud.position.copy(points.position);
    }
    
    // Add to scene
    scene.add(filteredCloud);
    
    // Return the point cloud
    return filteredCloud;
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

    // Create SVG with proper dimensions and padding
    const margin = {top: 10, right: 10, bottom: 30, left: 40};
    const width = window.innerWidth - margin.left - margin.right - 40; // 40px for left and right padding
    const height = 200 - margin.top - margin.bottom;
    
    const svg = histogramDiv.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

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
    svg.selectAll('rect.histogram-bar')
        .data(bins)
        .enter()
        .append('rect')
        .attr('class', 'histogram-bar')
        .attr('x', d => x(d.x0))
        .attr('y', d => y(d.length))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0))) // Removed the -1 to eliminate gaps
        .attr('height', d => height - y(d.length))
        .style('fill', 'white')
        .style('cursor', 'pointer')
        .on('click', function(event, d) {
            if (isShiftPressed) {
                // Add this range to the selection
                addSelectedRange(d.x0, d.x1);
                event.stopPropagation(); // Prevent other click handlers
            }
        });

    // Add highlight for selected range
    const minSlider = document.querySelector('input[type="range"]');
    const rangeSlider = document.querySelectorAll('input[type="range"]')[1];
    
    const minValue = parseFloat(minSlider.value);
    const rangeValue = parseFloat(rangeSlider.value);
    
    // Add highlight rectangle for current threshold
    svg.append('rect')
        .attr('x', x(minValue))
        .attr('y', 0)
        .attr('width', x(minValue + rangeValue) - x(minValue))
        .attr('height', height)
        .style('fill', 'rgba(255, 255, 0, 0.3)')
        .style('pointer-events', 'none')
        .attr('id', 'rangeHighlight');
    
    // Add highlight rectangles for selected ranges
    selectedRanges.forEach((range, i) => {
        const color = range.color;
        svg.append('rect')
            .attr('x', x(range.min))
            .attr('y', 0)
            .attr('width', x(range.max) - x(range.min))
            .attr('height', height)
            .style('fill', `rgba(${color[0]*255}, ${color[1]*255}, ${color[2]*255}, 0.3)`)
            .style('pointer-events', 'none')
            .attr('class', 'selected-range-highlight');
    });

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
        
    // Brush event handler
    function brushed(event) {
        if (!event.selection) return; // Ignore brush-by-zoom
        
        // Convert the brush selection from pixels to data values
        const [x0, x1] = event.selection.map(x.invert);
        
        if (isShiftPressed) {
            // Add this range to the selection
            addSelectedRange(x0, x1);
        } else {
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

// Create selection info panel
function createSelectionInfoPanel() {
    const selectionInfoDiv = document.createElement('div');
    selectionInfoDiv.id = 'selectionInfo';
    selectionInfoDiv.style.position = 'fixed';
    selectionInfoDiv.style.bottom = '230px'; // Position above histogram
    selectionInfoDiv.style.left = '20px';
    selectionInfoDiv.style.background = 'rgba(0, 0, 0, 0.7)';
    selectionInfoDiv.style.color = 'white';
    selectionInfoDiv.style.padding = '10px';
    selectionInfoDiv.style.borderRadius = '5px';
    selectionInfoDiv.style.fontSize = '14px';
    selectionInfoDiv.style.zIndex = '1000';
    selectionInfoDiv.innerHTML = `
        <div><b>Multi-Selection Mode</b></div>
        <div>Hold SHIFT + Click on histogram to select ranges</div>
        <div>Selected ranges: 0</div>
        <div id="rangesList" style="max-height: 100px; overflow-y: auto; margin-top: 5px;"></div>
        <div>
            <button id="clearSelectionBtn" style="margin-top: 5px; padding: 3px 8px; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;">
                Clear Selection
            </button>
            <button id="changeColorBtn" style="margin-top: 5px; margin-left: 5px; padding: 3px 8px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">
                Change Color
            </button>
        </div>
    `;
    document.body.appendChild(selectionInfoDiv);
    
    // Add event listeners for buttons
    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
    document.getElementById('changeColorBtn').addEventListener('click', openColorPicker);
}

// Function to clear selection
function clearSelection() {
    // Clear the selected ranges array
    selectedRanges = [];
    
    // Update the selection info panel
    updateSelectionInfo();
    
    // Update the shader uniforms
    updateSelectedRangesInShader();
    
    // Clear all filtered point clouds
    clearFilteredPointClouds();
    
    // Redraw histogram to remove selection highlights
    if (globalChargeMassRatios.length > 0) {
        createHistogram();
    }
}

// Function to open color picker
function openColorPicker() {
    if (selectedRanges.length === 0) {
        alert('Please select ranges first');
        return;
    }
    
    // Create a color picker if it doesn't exist
    let colorPicker = document.getElementById('colorPicker');
    if (!colorPicker) {
        colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.id = 'colorPicker';
        colorPicker.value = '#ff0000'; // Default red
        colorPicker.style.position = 'absolute';
        colorPicker.style.left = '-1000px'; // Hide it
        document.body.appendChild(colorPicker);
        
        colorPicker.addEventListener('change', function(e) {
            const color = new THREE.Color(e.target.value);
            changeSelectedRangeColor(color);
        });
    }
    
    // Trigger the color picker
    colorPicker.click();
}

// Function to change color of selected range
function changeSelectedRangeColor(color) {
    if (!points || selectedRanges.length === 0) return;
    
    // Get the currently selected range (last one in the array)
    const rangeIndex = selectedRanges.length - 1;
    
    // Update the color for this range
    selectedRanges[rangeIndex].color = [color.r, color.g, color.b];
    
    // Update the selection info
    updateSelectionInfo();
    
    // Update the filtered point cloud color if it exists
    if (filteredPointClouds[rangeIndex]) {
        filteredPointClouds[rangeIndex].material.color.set(color);
    }
    
    // Redraw histogram to update selection highlights
    if (globalChargeMassRatios.length > 0) {
        createHistogram();
    }
}

// Function to add a new selected range
function addSelectedRange(min, max) {
    // Check if we've reached the maximum number of ranges
    if (selectedRanges.length >= 20) {
        alert('Maximum number of selections reached (20)');
        return;
    }
    
    // Generate a random color for this range
    const hue = Math.random();
    const color = new THREE.Color().setHSL(hue, 1.0, 0.5);
    const colorArray = [color.r, color.g, color.b];
    
    // Add the new range
    selectedRanges.push({
        min: min,
        max: max,
        color: colorArray
    });
    
    // Create a filtered point cloud for this range
    const filteredCloud = createFilteredPointCloud(min, max, colorArray);
    
    // Add to the filtered point clouds array if created successfully
    if (filteredCloud) {
        filteredPointClouds.push(filteredCloud);
    }
    
    // Update the selection info
    updateSelectionInfo();
    
    // Redraw histogram to show selection highlights
    if (globalChargeMassRatios.length > 0) {
        createHistogram();
    }
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
            maxIndex: { value: minIndex + indexRange },
            selectedRangesCount: { value: 0 },
            selectedRanges: { value: new Float32Array(40).fill(-1) }, // 20 ranges (min, max pairs)
            selectedRangeColors: { value: new Float32Array(60).fill(1.0) } // 20 colors (r,g,b triplets)
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

// This function has been replaced by direct histogram selection

// Update selection info panel
function updateSelectionInfo() {
    const selectionInfoDiv = document.getElementById('selectionInfo');
    if (!selectionInfoDiv) return;
    
    const countElement = selectionInfoDiv.querySelector('div:nth-child(3)');
    if (countElement) {
        countElement.textContent = `Selected ranges: ${selectedRanges.length}`;
    }
    
    // Update the ranges list
    const rangesList = document.getElementById('rangesList');
    if (rangesList) {
        // Clear existing content
        rangesList.innerHTML = '';
        
        // Add each range to the list
        selectedRanges.forEach((range, index) => {
            const rangeItem = document.createElement('div');
            rangeItem.style.marginBottom = '3px';
            rangeItem.style.display = 'flex';
            rangeItem.style.alignItems = 'center';
            
            // Create color swatch
            const colorSwatch = document.createElement('span');
            colorSwatch.style.display = 'inline-block';
            colorSwatch.style.width = '12px';
            colorSwatch.style.height = '12px';
            colorSwatch.style.marginRight = '5px';
            colorSwatch.style.backgroundColor = `rgb(${range.color[0]*255}, ${range.color[1]*255}, ${range.color[2]*255})`;
            
            // Create range text
            const rangeText = document.createElement('span');
            rangeText.textContent = `Range ${index+1}: ${range.min.toFixed(2)} - ${range.max.toFixed(2)}`;
            
            // Add to range item
            rangeItem.appendChild(colorSwatch);
            rangeItem.appendChild(rangeText);
            rangesList.appendChild(rangeItem);
        });
    }
}

// Update selected ranges in shader
function updateSelectedRangesInShader() {
    if (!points) return;
    
    // Create Float32Arrays to hold the range data
    const rangesArray = new Float32Array(40).fill(-1); // 20 ranges (min, max pairs)
    const colorsArray = new Float32Array(60).fill(1.0); // 20 colors (r,g,b triplets)
    
    // Fill with actual selected ranges
    for (let i = 0; i < Math.min(selectedRanges.length, 20); i++) {
        const range = selectedRanges[i];
        
        // Set range min/max (2 values per range)
        rangesArray[i*2] = range.min;
        rangesArray[i*2+1] = range.max;
        
        // Set range color (3 values per color)
        colorsArray[i*3] = range.color[0];
        colorsArray[i*3+1] = range.color[1];
        colorsArray[i*3+2] = range.color[2];
    }
    
    // Update the shader uniforms
    points.material.uniforms.selectedRangesCount.value = selectedRanges.length;
    points.material.uniforms.selectedRanges.value = rangesArray;
    points.material.uniforms.selectedRangeColors.value = colorsArray;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Rotate the point cloud around the z-axis
    if (points) {
        points.rotation.z += rotationSpeed * 0.01;
        
        // Rotate all filtered point clouds to match the main point cloud
        filteredPointClouds.forEach(cloud => {
            cloud.rotation.z = points.rotation.z;
        });
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

// Add event listeners for shift key and mouse click
window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        isShiftPressed = true;
        document.body.style.cursor = 'crosshair'; // Change cursor to indicate selection mode
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        isShiftPressed = false;
        document.body.style.cursor = 'auto'; // Reset cursor
    }
});

window.addEventListener('click', (e) => {
    // We don't need to handle clicks here anymore since we're handling them directly in the histogram
    // The histogram bars and brush have their own click handlers
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

// Initialize and start animation
console.log('Initializing Three.js scene');
init();
console.log('Starting animation loop');
animate();
