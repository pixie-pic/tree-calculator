// Calendar JavaScript
const monthYear = document.getElementById('month-year');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthButton = document.getElementById('prev-month');
const nextMonthButton = document.getElementById('next-month');

let currentDate = new Date();
let selectedDate = null;
let availableDates = new Set(); // To store dates with available data

// Show loading overlay
function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

// Hide loading overlay
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// Fetch available dates from the server
async function fetchAvailableDates() {
    showLoading();
    try {
        const response = await fetch('/get-available-dates');
        if (!response.ok) {
            throw new Error('Failed to fetch available dates');
        }
        const data = await response.json();
        // Store dates in the same format as they come from the server (DD/MM/YYYY)
        availableDates = new Set(data.dates);
    } catch (error) {
        console.error('Error fetching available dates:', error);
    } finally {
        hideLoading();
    }
}

// Check if a date has available data
function hasDataForDate(date) {
    if (!date) return false;
    
    // Format the date to match the server format (DD/MM/YYYY)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    console.log('Checking date:', dateStr, 'Available:', availableDates.has(dateStr));
    
    // If availableDates is not loaded yet, return false to show loading state
    if (availableDates.size === 0) return false;
    
    return availableDates.has(dateStr);
}

const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Set month and year in header
    monthYear.textContent = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(currentDate) + ' ' + year;

    // Clear previous days
    calendarGrid.innerHTML = '';

    // Add day names row
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(day => {
        const dayNameElement = document.createElement('div');
        dayNameElement.classList.add('calendar-day-name');
        dayNameElement.textContent = day;
        calendarGrid.appendChild(dayNameElement);
    });

    // Get the first day of the month
    const firstDay = new Date(year, month, 1);
    const startingDay = firstDay.getDay();

    // Get the number of days in the month
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Add empty cells for days before the first day
    for (let i = 0; i < startingDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.classList.add('calendar-day', 'empty');
        calendarGrid.appendChild(emptyDay);
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
        const day = document.createElement('div');
        const currentDay = new Date(year, month, i);
        const hasData = hasDataForDate(currentDay);
        
        day.textContent = i;
        
        if (hasData) {
            day.classList.add('calendar-day');
            
            // Highlight selected date
            if (selectedDate && i === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
                day.classList.add('selected');
            }

            day.addEventListener('click', (event) => {
                // Create a new date object to avoid reference issues
                selectedDate = new Date(currentDay);
                renderCalendar();
                // Use the real event if available, else a dummy
                if (selectedCountry && selectedDate) {
                    fetchTreeData(event || {pageX:0, pageY:0, clientX:0, clientY:0});
                }
            });
        } else {
            // Style for days without data
            day.classList.add('calendar-day', 'no-data');
            day.title = 'No emissions data available for this date';
            day.style.cursor = 'not-allowed';
            day.style.opacity = '0.5';
        }

        calendarGrid.appendChild(day);
    }
}

prevMonthButton.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
});

nextMonthButton.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
});

// Initial setup
fetchAvailableDates().then(() => {
    // Set default selected date to today if it has data
    const today = new Date();
    if (hasDataForDate(today)) {
        selectedDate = new Date(today);
    } else {
        // If today has no data, find the most recent date with data
        const datesArray = Array.from(availableDates);
        if (datesArray.length > 0) {
            // Sort dates in descending order (most recent first)
            const sortedDates = datesArray.sort((a, b) => {
                const [dayA, monthA, yearA] = a.split('/').map(Number);
                const [dayB, monthB, yearB] = b.split('/').map(Number);
                return new Date(yearB, monthB - 1, dayB) - new Date(yearA, monthA - 1, dayA);
            });
            
            // Get the most recent date
            const [day, month, year] = sortedDates[0].split('/').map(Number);
            selectedDate = new Date(year, month - 1, day);
            currentDate = new Date(selectedDate); // Set current view to the selected date
        }
    }
    renderCalendar();
});


// Map
let selectedCountry = null;
let countriesWithData = new Set();

// Store original instructions text for reset
let originalInstructionsHTML = "";

// Map dimensions
const width = 1000;
const height = 500; 

// Select the SVG map container
const svg = d3.select("#map");
const mapContainer = document.getElementById('map-container');

// Create a projection (Mercator is common for world maps)
const projection = d3.geoMercator()
    .scale(550) // Increased zoom level
    .center([30, 50]) // Longitude, Latitude roughly centering Eurasia
    .translate([width / 2, height / 2]);

// Path generator
const path = d3.geoPath().projection(projection);

const tooltip = d3.select("#tooltip");
const treeBox = document.getElementById('tree-box');
const instructionsBox = document.getElementById('instructions-box');

// Save original instructions when the page loads
document.addEventListener('DOMContentLoaded', () => {
    if (instructionsBox) {
        originalInstructionsHTML = instructionsBox.innerHTML;
    }
    // Add scroll-to-instructions on tree box click
    if (treeBox && instructionsBox) {
        treeBox.addEventListener('click', () => {
            instructionsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
});

// Function to position tooltip and box relative to map container
function getMapRelativePosition(event) {
    const mapRect = mapContainer.getBoundingClientRect();
    return {
        x: event.clientX - mapRect.left,
        y: event.clientY - mapRect.top
    };
}

// Function to load map with all countries but different styling based on data availability
async function loadMap() {
    showLoading(); // Show loading overlay when map starts loading
    try {
        // First, get the list of countries with data
        const countriesResponse = await fetch('/get-countries-with-data');
        if (!countriesResponse.ok) {
            throw new Error('Failed to fetch countries data');
        }
        const countriesData = await countriesResponse.json();

        if (countriesData.status === 'success') {
            countriesWithData = new Set(countriesData.countries);
            
            // Now load the map data
            const mapResponse = await d3.json("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson");
            
            // Save original instructions
            if (instructionsBox && !originalInstructionsHTML) {
                originalInstructionsHTML = instructionsBox.innerHTML;
            }

            // Update the data bound to the map
            const paths = svg.selectAll("path")
                .data(mapResponse.features, d => d.properties.name);
            
            // Remove old paths
            paths.exit().remove();
            
            // Add new paths
            paths.enter()
                .append("path")
                .merge(paths)
                .attr("class", d => 
                    countriesWithData.has(d.properties.name) ? "country has-data" : "country no-data"
                )
                .attr("d", path)
                .on("mouseover", (event, d) => {
                    // Get position relative to map container
                    const pos = getMapRelativePosition(event);
                    
                    // Show tooltip on hover
                    tooltip.style("display", "block")
                           .html(d.properties.name + (countriesWithData.has(d.properties.name) ? "" : " (No data)"))
                           .style("left", pos.x + 10 + "px")
                           .style("top", pos.y - 10 + "px");
                })
                .on("mousemove", (event, d) => {
                    // Update tooltip position when mouse moves
                    const pos = getMapRelativePosition(event);
                    tooltip.style("left", pos.x + 10 + "px")
                           .style("top", pos.y - 10 + "px");
                })
                .on("mouseleave", () => {
                    tooltip.style("display", "none");
                })
                .on("click", (event, d) => {
                    if (!countriesWithData.has(d.properties.name)) {
                        return; // Don't do anything for countries without data
                    }
                    event.stopPropagation(); // Prevent click from reaching document
                    tooltip.style("display", "none");
                    selectedCountry = d.properties.name;  // Store clicked country
                    // Always try to fetch data if both are set
                    if (selectedCountry && selectedDate) {
                        fetchTreeData(event);
                    } else if (!selectedDate) {
                        // Show error box on click with correct positioning
                        const pos = getMapRelativePosition(event);
                        treeBox.style.display = "block";
                        treeBox.innerHTML = "<strong>" + d.properties.name + "</strong><br>Please select a date";
                        treeBox.style.left = pos.x + 10 + "px";
                        treeBox.style.top = pos.y + 10 + "px";
                    }
                });
        } else {
            throw new Error('Failed to load countries data');
        }
    } catch (error) {
        console.error("Error loading map:", error);
        // Show error to user
        alert('Failed to load the map. Please refresh the page to try again.');
    } finally {
        hideLoading(); 
    }
}

// Handle clicks outside the tree box to close it and reset selection
document.addEventListener("click", (event) => {
    // Check if the click is outside the tree box and not on a country
    if (!event.target.closest(".country") && !event.target.closest("#tree-box")) {
        // Hide tree box
        if (treeBox) {
            treeBox.style.display = 'none';
        }
        
        // Reset the instruction box
        if (instructionsBox) {
            instructionsBox.style.display = 'block';  // Make sure it is visible
            if (originalInstructionsHTML) {
                instructionsBox.innerHTML = originalInstructionsHTML;  // Reset to original instructions
            }
        }
    }
});

// Initial map load
loadMap();

async function fetchTreeData(event) {
    // Show loading overlay
    showLoading();
    
    // Initialize pos with default values
    let pos = { x: 0, y: 0 };
    
    try {
        // Update pos with actual position relative to map container
        pos = getMapRelativePosition(event);
        // Check if the selected date exists and country is selected
        if (!selectedDate || !selectedCountry) {
            // Get position relative to map container
            const pos = getMapRelativePosition(event);
            
            if (instructionsBox) {
                instructionsBox.style.display = 'block'; // Ensure instructions box is visible
                instructionsBox.style.left = pos.x + 10 + "px";
                instructionsBox.style.top = pos.y + 10 + "px";
                instructionsBox.innerHTML = `
                    <h3>Please select a date and a country</h3>
                    <div>Click on a country to see detailed data. Make sure you select a valid date from the calendar.</div>
                `;
            }
            
            if (treeBox) {
                treeBox.style.display = 'none'; // Hide tree box if no date or country selected
            }
            return;
        }

        // Format the selected date for the API
        const day = selectedDate.getDate().toString().padStart(2, '0');
        const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
        const year = selectedDate.getFullYear();
        const formattedDate = `${day}/${month}/${year}`;

        // Update position relative to map container
        pos = getMapRelativePosition(event);

        // Fetch data from the server
        const response = await fetch('/get-tree-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: formattedDate,
                country: selectedCountry
            })
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const data = await response.json();
        // Show the tree box and set general content (trees needed)
        if (treeBox) {
            treeBox.style.display = "block";
            treeBox.style.left = pos.x + 10 + "px";
            treeBox.style.top = pos.y + 10 + "px";
            let treeBoxHtml = `
                <div class="tree-header">
                    <span class="tree-icon">🌳</span>
                    <h3>${selectedCountry}</h3>
                </div>
                <div class="section">
                    <strong>🌲 Trees needed to offset daily emissions:</strong>
                    <div style="font-size: 1.4em; text-align: center; margin: 10px 0;">
                        ${data.trees_needed ? data.trees_needed.toLocaleString() : 'Insufficient data'} trees
                    </div>
                </div>`;

            treeBox.innerHTML = treeBoxHtml;
        }

        // Show the instructions box and set detailed content
        if (instructionsBox) {
            instructionsBox.style.display = 'block'; // Show the instructions box
            instructionsBox.style.left = pos.x + 10 + "px"; // Position it next to the mouse
            instructionsBox.style.top = pos.y + 200 + "px"; // Position it below the tree box
            
            let instructionsHtml = `
                <h3>${selectedCountry}</h3>
                <div class="section">
                    <strong>📅 Daily Carbon Data</strong>
                    <div style="margin-top: 8px;">
                        <div>Emissions: <strong>${data.carbon_emissions_mt.toFixed(2)} MtCO₂</strong></div>
                    </div>
                </div>`;

            // Add species information if available - limit to 3 most common
            if (data.species_info && data.species_info.length > 0) {
                // Take only up to 3 species
                const topSpecies = data.species_info.slice(0, 3);
                
                let speciesTitle = data.is_approximation
                    ? '🌿 Based on the most common tree in the dataset:'
                    : '🌳 Most common tree species:';
                instructionsHtml += `
                    <div class="section">
                        <strong>${speciesTitle}</strong>
                        <div class="species-list">`;

                topSpecies.forEach(function(species, index) {
                    const treesNeeded = species.trees_needed === Infinity ? 'Insufficient data' : 
                        species.trees_needed.toLocaleString();
                    
                    instructionsHtml += `
                        <div class="species-item">
                            <strong>${index + 1}. ${species.species}</strong><br>
                            <small>
                                Trees needed: <strong>${treesNeeded}</strong><br>
                                (${species.carbon_kg_per_tree.toFixed(2)} kg CO₂/tree)
                            </small>
                        </div>`;
                });
                
                instructionsHtml += `</div></div>`;
            }

            // Add carbon absorption data if available
            if (data.avg_carbon_kg_per_tree) {
                instructionsHtml += `
                <div class="section">
                    <div>Avg. carbon absorption per tree: <strong>${data.avg_carbon_kg_per_tree.toFixed(2)} kg CO₂</strong></div>
                </div>`;
            }
            
            instructionsBox.innerHTML = instructionsHtml;
        }
    } catch (error) {
        console.error('There was an error with the fetch operation:', error);
        
        // Show error message to user if possible
        if (treeBox) {
            treeBox.style.display = "block";
            treeBox.style.left = pos.x + 10 + "px";
            treeBox.style.top = pos.y + 10 + "px";
            treeBox.innerHTML = `
                <div class="tree-header">
                    <span class="tree-icon">❌</span>
                    <h3>Error</h3>
                </div>
                <div class="section">
                    <p>Failed to load data. Please try again.</p>
                </div>`;
        }
    } finally {
        // Always hide the loading overlay when done
        hideLoading();
    }
}