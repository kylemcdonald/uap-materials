import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as d3 from 'd3';

let scene, camera, renderer, controls, points;
const dropZone = document.getElementById('dropZone');
let globalChargeMassRatios = []; // Store charge-mass ratios for histogram
let globalPositions = []; // Store positions for filtered views
let globalIndices = []; // Store indices for filtered views
let rotationSpeed = 0.1; // Default rotation speed in radians per second
let totalPoints = 0; // Total number of points in the loaded file
let minIndex = 0; // Minimum index to display
let indexRange = 1000000; // Number of points to display
let selectedRanges = []; // Array to store selected charge-mass ratio ranges
let filteredPointClouds = []; // Array to store filtered point clouds
let isShiftPressed = false; // Track if shift key is pressed
let isOrthographicCamera = false; // Track camera type (false = perspective, true = orthographic)

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
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.001, 10000);
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
    
    // Create camera type slider
    createCameraTypeSlider();

    // Create selection info panel
    createSelectionInfoPanel();

    camera.position.z = 5;
}

// Handle window resize
function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    
    if (isOrthographicCamera) {
        // Update orthographic camera
        const frustumSize = 10;
        camera.left = frustumSize * aspect / -2;
        camera.right = frustumSize * aspect / 2;
        camera.top = frustumSize / 2;
        camera.bottom = frustumSize / -2;
    } else {
        // Update perspective camera
        camera.aspect = aspect;
    }
    
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
    
    // Create shader material with the same size uniform as the main point cloud
    const material = new THREE.ShaderMaterial({
        uniforms: {
            size: { value: points.material.uniforms.size.value },
            color: { value: new THREE.Color(color[0], color[1], color[2]) }
        },
        vertexShader: `
            uniform float size;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            void main() {
                gl_FragColor = vec4(color, 1.0);
            }
        `,
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
    
    // Remove existing tooltip if any
    d3.select('.tooltip').remove();
    
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

    // Create tooltip
    const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'fixed')
        .style('visibility', 'hidden')
        .style('background-color', 'rgba(0, 0, 0, 0.8)')
        .style('color', 'white')
        .style('padding', '5px 10px')
        .style('border-radius', '5px')
        .style('font-size', '14px')
        .style('pointer-events', 'none')
        .style('z-index', '9999')
        .style('box-shadow', '0 0 5px rgba(0,0,0,0.5)')
        .style('border', '1px solid rgba(255,255,255,0.3)');

    // Isotopic ratios data for tooltips
    const isotopicRatios = {
        1.008: '¹H',
        2.014: '²H',  // Deuterium
        3.016: '³H',  // Tritium
        4.003: '⁴He',
        6.941: '⁷Li',
        7.016: '⁷Li',  // Li-7
        9.012: '⁹Be',
        10.811: '¹¹B',
        11.009: '¹¹B',  // B-11
        12.011: '¹²C',
        13.003: '¹³C',  // C-13
        14.007: '¹⁴N',
        15.000: '¹⁵N',  // N-15
        15.999: '¹⁶O',
        17.999: '¹⁸O',  // O-18
        18.998: '¹⁹F',
        20.180: '²⁰Ne',
        22.990: '²³Na',
        23.985: '²³Na',  // Na-23
        24.305: '²⁴Mg',
        25.983: '²⁶Mg',  // Mg-26
        26.982: '²⁷Al',
        27.977: '²⁷Al',  // Al-27
        28.086: '²⁸Si',
        29.974: '³⁰Si',  // Si-30
        30.974: '³¹P',
        31.974: '³¹P',  // P-31
        32.065: '³²S',
        33.968: '³⁴S',  // S-34
        35.453: '³⁵Cl',
        34.969: '³⁵Cl',  // Cl-35
        36.966: '³⁷Cl',  // Cl-37
        39.948: '⁴⁰Ar',
        39.098: '³⁹K',
        38.964: '³⁹K',  // K-39
        40.962: '⁴¹K',  // K-41
        40.078: '⁴⁰Ca',
        39.963: '⁴⁰Ca',  // Ca-40
        43.955: '⁴⁴Ca',  // Ca-44
        44.956: '⁴⁵Sc',
        47.867: '⁴⁸Ti',
        47.948: '⁴⁸Ti',  // Ti-48
        50.942: '⁵¹V',
        50.944: '⁵¹V',  // V-51
        51.996: '⁵²Cr',
        51.941: '⁵²Cr',  // Cr-52
        54.938: '⁵⁵Mn',
        54.938: '⁵⁵Mn',  // Mn-55
        55.845: '⁵⁶Fe',
        55.935: '⁵⁶Fe',  // Fe-56
        58.933: '⁵⁹Co',
        58.933: '⁵⁹Co',  // Co-59
        58.693: '⁵⁸Ni',
        57.935: '⁵⁸Ni',  // Ni-58
        63.546: '⁶³Cu',
        62.930: '⁶³Cu',  // Cu-63
        64.928: '⁶⁵Cu',  // Cu-65
        65.380: '⁶⁴Zn',
        63.929: '⁶⁴Zn',  // Zn-64
        65.926: '⁶⁶Zn',  // Zn-66
        69.723: '⁶⁹Ga',
        68.926: '⁶⁹Ga',  // Ga-69
        70.925: '⁷¹Ga',  // Ga-71
        72.640: '⁷⁴Ge',
        73.921: '⁷⁴Ge',  // Ge-74
        74.922: '⁷⁵As',
        74.922: '⁷⁵As',  // As-75
        78.960: '⁸⁰Se',
        79.917: '⁸⁰Se',  // Se-80
        79.904: '⁷⁹Br',
        78.918: '⁷⁹Br',  // Br-79
        80.916: '⁸¹Br',  // Br-81
        83.798: '⁸⁴Kr',
        83.911: '⁸⁴Kr',  // Kr-84
        85.468: '⁸⁵Rb',
        84.912: '⁸⁵Rb',  // Rb-85
        86.909: '⁸⁷Rb',  // Rb-87
        87.620: '⁸⁸Sr',
        87.906: '⁸⁸Sr',  // Sr-88
        88.906: '⁸⁹Y',
        88.906: '⁸⁹Y',  // Y-89
        91.224: '⁹⁰Zr',
        89.905: '⁹⁰Zr',  // Zr-90
        92.906: '⁹³Nb',
        92.906: '⁹³Nb',  // Nb-93
        95.960: '⁹⁸Mo',
        97.905: '⁹⁸Mo',  // Mo-98
        98.000: '⁹⁹Tc',
        101.070: '¹⁰¹Ru',
        102.906: '¹⁰³Rh',
        106.420: '¹⁰⁶Pd',
        107.868: '¹⁰⁷Ag',
        112.411: '¹¹²Cd',
        114.818: '¹¹⁵In',
        118.710: '¹¹⁸Sn',
        121.760: '¹²¹Sb',
        127.600: '¹²⁸Te',
        126.904: '¹²⁷I',
        131.293: '¹³¹Xe',
        132.905: '¹³³Cs',
        137.327: '¹³⁷Ba',
        138.905: '¹³⁹La',
        140.116: '¹⁴⁰Ce',
        140.908: '¹⁴¹Pr',
        144.242: '¹⁴⁴Nd',
        145.000: '¹⁴⁵Pm',
        150.360: '¹⁵⁰Sm',
        151.964: '¹⁵¹Eu',
        157.250: '¹⁵⁷Gd',
        158.925: '¹⁵⁹Tb',
        162.500: '¹⁶²Dy',
        164.930: '¹⁶⁵Ho',
        167.259: '¹⁶⁶Er',
        168.934: '¹⁶⁹Tm',
        173.054: '¹⁷²Yb',
        174.967: '¹⁷⁵Lu',
        178.490: '¹⁷⁸Hf',
        180.948: '¹⁸¹Ta',
        183.840: '¹⁸⁴W',
        186.207: '¹⁸⁷Re',
        190.230: '¹⁹⁰Os',
        192.217: '¹⁹³Ir',
        195.084: '¹⁹⁵Pt',
        196.967: '¹⁹⁷Au',
        200.590: '²⁰⁰Hg',
        204.383: '²⁰⁵Tl',
        207.200: '²⁰⁷Pb',
        208.980: '²⁰⁹Bi',
        209.000: '²⁰⁹Po',
        210.000: '²¹⁰At',
        222.000: '²²²Rn',
        223.000: '²²³Fr',
        226.000: '²²⁶Ra',
        227.000: '²²⁷Ac',
        232.038: '²³²Th',
        231.036: '²³¹Pa',
        238.029: '²³⁸U',
        237.000: '²³⁷Np',
        244.000: '²⁴⁴Pu',
        243.000: '²⁴³Am',
        247.000: '²⁴⁷Cm',
        247.000: '²⁴⁷Bk',
        251.000: '²⁵¹Cf',
        252.000: '²⁵²Es',
        257.000: '²⁵⁷Fm',
        258.000: '²⁵⁸Md',
        259.000: '²⁵⁹No',
        262.000: '²⁶²Lr'
    };

    // Function to find the closest isotopic ratio
    function findClosestIsotope(mass) {
        let closestMass = null;
        let minDiff = Infinity;
        
        for (const [isoMass, label] of Object.entries(isotopicRatios)) {
            const diff = Math.abs(parseFloat(isoMass) - mass);
            if (diff < minDiff) {
                minDiff = diff;
                closestMass = isoMass;
            }
        }
        
        return closestMass ? isotopicRatios[closestMass] : null;
    }

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
        })
        .on('mouseover', function(event, d) {
            const mass = (d.x0 + d.x1) / 2; // Use the middle of the bin
            const isotope = findClosestIsotope(mass);
            
            if (isotope) {
                console.log(`Showing tooltip for mass ${mass.toFixed(3)}, isotope ${isotope}`);
                tooltip
                    .style('visibility', 'visible')
                    .html(`Mass: ${mass.toFixed(3)}<br>Isotope: ${isotope}`)
                    .style('left', (event.clientX + 10) + 'px')
                    .style('top', (event.clientY - 28) + 'px');
            }
        })
        .on('mousemove', function(event, d) {
            const mass = (d.x0 + d.x1) / 2; // Use the middle of the bin
            const isotope = findClosestIsotope(mass);
            
            if (isotope) {
                tooltip
                    .style('visibility', 'visible')
                    .html(`Mass: ${mass.toFixed(3)}<br>Isotope: ${isotope}`)
                    .style('left', (event.clientX + 10) + 'px')
                    .style('top', (event.clientY - 28) + 'px');
            }
        })
        .on('mouseout', function() {
            console.log('Hiding tooltip');
            tooltip.style('visibility', 'hidden');
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
        
    // Add direct event listener to the histogram container
    histogramDiv.on('mousemove', function(event) {
        // Get the mouse position relative to the SVG
        const svgRect = svg.node().getBoundingClientRect();
        const mouseX = event.clientX - svgRect.left - margin.left;
        
        // Convert to data domain
        const mass = x.invert(mouseX);
        
        // Find the closest isotope
        const isotope = findClosestIsotope(mass);
        
        if (isotope) {
            tooltip
                .style('visibility', 'visible')
                .html(`Mass: ${mass.toFixed(3)}<br>Isotope: ${isotope}`)
                .style('left', (event.clientX + 10) + 'px')
                .style('top', (event.clientY - 28) + 'px');
        }
    })
    .on('mouseout', function() {
        tooltip.style('visibility', 'hidden');
    });
        
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
    controlsDiv.style.background = 'rgba(0, 0, 0, 0.7)';
    controlsDiv.style.padding = '10px';
    controlsDiv.style.borderRadius = '5px';
    controlsDiv.style.color = 'white';
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
    rotationSlider.max = '1';
    rotationSlider.value = '0.1';
    rotationSlider.step = '0.01';
    rotationSlider.style.width = '200px';
    controlsDiv.appendChild(rotationSlider);

    // Create rotation speed value display
    const rotationValueDisplay = document.createElement('span');
    rotationValueDisplay.textContent = '0.1';
    rotationValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(rotationValueDisplay);

    // Create min index label
    const minIndexLabel = document.createElement('label');
    minIndexLabel.textContent = 'Min Index: ';
    minIndexLabel.style.display = 'block';
    minIndexLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(minIndexLabel);

    // Create min index slider
    const minIndexSlider = document.createElement('input');
    minIndexSlider.type = 'range';
    minIndexSlider.min = '0';
    minIndexSlider.max = '1000000';
    minIndexSlider.value = '0';
    minIndexSlider.step = '1000';
    minIndexSlider.style.width = '200px';
    controlsDiv.appendChild(minIndexSlider);

    // Create min index value display
    const minIndexValueDisplay = document.createElement('span');
    minIndexValueDisplay.textContent = '0';
    minIndexValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(minIndexValueDisplay);

    // Create index range label
    const indexRangeLabel = document.createElement('label');
    indexRangeLabel.textContent = 'Index Range: ';
    indexRangeLabel.style.display = 'block';
    indexRangeLabel.style.marginTop = '10px';
    indexRangeLabel.style.marginBottom = '5px';
    controlsDiv.appendChild(indexRangeLabel);

    // Create index range slider
    const indexRangeSlider = document.createElement('input');
    indexRangeSlider.type = 'range';
    indexRangeSlider.min = '1000';
    indexRangeSlider.max = '1000000';
    indexRangeSlider.value = '1000000';
    indexRangeSlider.step = '1000';
    indexRangeSlider.style.width = '200px';
    controlsDiv.appendChild(indexRangeSlider);

    // Create index range value display
    const indexRangeValueDisplay = document.createElement('span');
    indexRangeValueDisplay.textContent = '1000000';
    indexRangeValueDisplay.style.marginLeft = '10px';
    controlsDiv.appendChild(indexRangeValueDisplay);

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

    // Add index control event listeners
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
        
        // Update the point cloud if it exists
        if (points) {
            updatePointCloudIndexRange();
        }
    });
    
    // Function to update slider max values based on total points
    function updateSliderMaxValues() {
        // Update min index slider max
        minIndexSlider.max = totalPoints.toString();
        
        // Update index range slider max
        const maxRange = totalPoints;
        indexRangeSlider.max = maxRange.toString();
        
        // Set index range to maximum value by default
        indexRangeSlider.value = maxRange.toString();
        indexRangeValueDisplay.textContent = maxRange.toLocaleString();
        indexRange = maxRange;
        
        // If current values exceed new max, adjust them
        if (parseInt(minIndexSlider.value) > totalPoints) {
            minIndexSlider.value = '0';
            minIndexValueDisplay.textContent = '0';
            minIndex = 0;
        }
        
        // Update the point cloud if it exists
        if (points) {
            updatePointCloudIndexRange();
        }
    }
    
    // Store the update function for later use
    window.updateIndexSliders = updateSliderMaxValues;
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
    
    // Get color from d3.schemeCategory10 based on the current number of ranges
    const color = new THREE.Color(d3.schemeCategory10[selectedRanges.length % 10]);
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

// Update point cloud based on index range
function updatePointCloudIndexRange() {
    if (!points) return;
    
    // Update the shader uniforms
    points.material.uniforms.minIndex.value = minIndex;
    points.material.uniforms.maxIndex.value = minIndex + indexRange;
}

// Create camera type slider
function createCameraTypeSlider() {
    // Get the controls container
    const controlsDiv = document.getElementById('controls');
    if (!controlsDiv) return;

    // Create a container for the buttons at the top
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginBottom = '20px';
    buttonContainer.style.paddingBottom = '10px';
    buttonContainer.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
    controlsDiv.insertBefore(buttonContainer, controlsDiv.firstChild);

    // Create camera type toggle button
    const cameraTypeButton = document.createElement('button');
    cameraTypeButton.textContent = 'Perspective';
    cameraTypeButton.style.padding = '5px 10px';
    cameraTypeButton.style.backgroundColor = '#4CAF50';
    cameraTypeButton.style.color = 'white';
    cameraTypeButton.style.border = 'none';
    cameraTypeButton.style.borderRadius = '4px';
    cameraTypeButton.style.cursor = 'pointer';
    cameraTypeButton.style.fontWeight = 'bold';
    buttonContainer.appendChild(cameraTypeButton);

    // Create export PLY button
    const exportButton = document.createElement('button');
    exportButton.textContent = 'Export PLY';
    exportButton.style.display = 'inline-block';
    exportButton.style.marginLeft = '10px';
    exportButton.style.padding = '5px 10px';
    exportButton.style.backgroundColor = '#4CAF50';
    exportButton.style.color = 'white';
    exportButton.style.border = 'none';
    exportButton.style.borderRadius = '4px';
    exportButton.style.cursor = 'pointer';
    exportButton.addEventListener('click', exportToPLY);
    buttonContainer.appendChild(exportButton);

    // Add event listener for camera type button
    cameraTypeButton.addEventListener('click', function() {
        isOrthographicCamera = !isOrthographicCamera;
        cameraTypeButton.textContent = isOrthographicCamera ? 'Orthographic' : 'Perspective';
        cameraTypeButton.style.backgroundColor = isOrthographicCamera ? '#2196F3' : '#4CAF50';
        
        // Get current camera position and target
        const position = camera.position.clone();
        const target = controls.target.clone();
        
        // Create new camera based on selected type
        if (isOrthographicCamera) {
            // Calculate orthographic camera parameters
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = 10;
            const orthoCamera = new THREE.OrthographicCamera(
                frustumSize * aspect / -2,
                frustumSize * aspect / 2,
                frustumSize / 2,
                frustumSize / -2,
                0.1,
                1000
            );
            
            // Replace the old camera with the new one
            scene.remove(camera);
            camera = orthoCamera;
            scene.add(camera);
            
            // Update controls to use the new camera
            controls.object = camera;
        } else {
            // Create perspective camera
            const perspectiveCamera = new THREE.PerspectiveCamera(
                75,
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
            
            // Replace the old camera with the new one
            scene.remove(camera);
            camera = perspectiveCamera;
            scene.add(camera);
            
            // Update controls to use the new camera
            controls.object = camera;
        }
        
        // Restore camera position and target
        camera.position.copy(position);
        controls.target.copy(target);
        
        // Update camera
        camera.updateProjectionMatrix();
        controls.update();
    });
}

// Function to export visible points to PLY format
function exportToPLY() {
    if (!points) {
        alert('No point cloud loaded');
        return;
    }

    // Get the geometry and attributes
    const geometry = points.geometry;
    const positions = geometry.attributes.position.array;
    const chargeMassRatios = geometry.attributes.chargeMassRatio.array;
    const indices = geometry.attributes.index.array;
    
    // Get the current threshold values
    const minThreshold = points.material.uniforms.minThreshold.value;
    const maxThreshold = points.material.uniforms.maxThreshold.value;
    const minIndex = points.material.uniforms.minIndex.value;
    const maxIndex = points.material.uniforms.maxIndex.value;
    
    // Count visible points
    let visibleCount = 0;
    const visibleIndices = [];
    
    for (let i = 0; i < chargeMassRatios.length; i++) {
        const cmr = chargeMassRatios[i];
        const idx = indices[i];
        
        // Check if point is within threshold and index range
        if (cmr >= minThreshold && cmr <= maxThreshold && idx >= minIndex && idx < maxIndex) {
            visibleCount++;
            visibleIndices.push(i);
        }
    }
    
    if (visibleCount === 0) {
        alert('No visible points to export');
        return;
    }
    
    // Create PLY header
    let plyContent = 'ply\n';
    plyContent += 'format ascii 1.0\n';
    plyContent += `element vertex ${visibleCount}\n`;
    plyContent += 'property float x\n';
    plyContent += 'property float y\n';
    plyContent += 'property float z\n';
    plyContent += 'property float charge_mass_ratio\n';
    plyContent += 'end_header\n';
    
    // Add point data
    for (const i of visibleIndices) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const cmr = chargeMassRatios[i];
        
        plyContent += `${x} ${y} ${z} ${cmr}\n`;
    }
    
    // Create download link
    const blob = new Blob([plyContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'point_cloud.ply';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`Exported ${visibleCount} points to PLY file`);
}

// Initialize and start animation
console.log('Initializing Three.js scene');
init();
console.log('Starting animation loop');
animate();
