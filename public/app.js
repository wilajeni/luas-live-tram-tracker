/* ==========================================================================
   LUAS TRACKER CLIENT CONTROLLER - MAP RENDERING & DYNAMIC STATE SYNC
   ========================================================================== */

let map;
let stopsData = {};
let stopsMap = {};
let stopMarkers = {};
let tramMarkers = {};
let selectedStopAbbrev = null;
let currentTab = 'Inbound'; // 'Inbound' or 'Outbound'
let apiPollInterval;
let timetableCountdownInterval;
let activeLineFilter = null; // 'Red', 'Green' or null
let knownVehicles = [];
let tramFinderLineFilter = 'All';
let vehicleHistoryMeta = { currentCount: 0, lastUpdated: null };

const MAP_TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const MAP_TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
let tileLayer;

// Map track geometries paths stop abbrevs
const TRACKS_PATHS = {
  red_main: ['TPT', 'SDK', 'MYS', 'GDK', 'BUS', 'ABB', 'JER', 'FOU', 'SMI', 'MUS', 'HEU', 'JAM', 'FAT', 'RIA', 'SUI', 'GOL', 'DRI', 'BLA', 'BLU', 'KYL', 'RED', 'KIN', 'BEL'],
  red_branch_tal: ['BEL', 'COO', 'HOS', 'TAL'],
  red_branch_sag: ['BEL', 'FET', 'CVN', 'CIT', 'FOR', 'SAG'],
  red_spur_con: ['ABB', 'CON'],
  
  green_main: ['BRO', 'CAB', 'PHI', 'GRA', 'BRD', 'DOM', 'PAR', 'MAR', 'TRY', 'DAW', 'STS', 'HAR', 'CHA', 'RAN', 'BEE', 'COW', 'MIL', 'WIN', 'DUN', 'BAL', 'KIL', 'STI', 'SAN', 'CPK', 'GLE', 'GAL', 'LEO', 'BAW', 'CCK', 'LAU', 'CHE', 'BRI'],
  // Draw O'Connell loops explicitly for map line layout
  green_north_loop: ['STS', 'DAW', 'WES', 'OGP', 'OUP', 'PAR', 'DOM']
};

let trackSegments = {};

async function loadTracksGeometry() {
  try {
    const response = await fetch('/luas_tracks.json');
    const data = await response.json();
    trackSegments = data.segments || {};
  } catch (error) {
    console.error('Error loading track segments geometry:', error);
  }
}

// 1. Initializer
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  configureLocalOnlyUI();
  initMap();
  await loadStops();
  await loadTracksGeometry();
  drawTracks();
  setupUIEventListeners();
  
  // Initial poll and schedule updates
  pollStatus();
  pollTrams();
  pollVehicleHistory();
  
  apiPollInterval = setInterval(() => {
    pollStatus();
    pollTrams();
    pollVehicleHistory();
  }, 4000); // Poll trams/status every 4 seconds

  // Handle minor countdown updates on departures board every second
  timetableCountdownInterval = setInterval(updateDeparturesCountdownLocal, 1000);
});

function configureLocalOnlyUI() {
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  document.querySelectorAll('.local-only').forEach(element => {
    element.style.display = isLocal ? '' : 'none';
  });
}

// 2. Leaflet Map setup
// ==========================================================================
function initMap() {
  // Dublin Coordinates
  map = L.map('live-map-container', {
    zoomControl: true,
    minZoom: 10,
    maxZoom: 18
  }).setView([53.335, -6.26], 12);

  tileLayer = L.tileLayer(MAP_TILES_DARK, {
    attribution: MAP_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Set default view on zoom out
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    map.setView([53.335, -6.26], 12);
  });
}

// 3. Load stops data
// ==========================================================================
async function loadStops() {
  try {
    const response = await fetch('/api/stops');
    stopsData = await response.json();
    
    // Group all stops in flat map
    for (const line in stopsData) {
      const isRed = line.includes('Red');
      stopsData[line].forEach(stop => {
        stop.line = isRed ? 'Red' : 'Green';
        stopsMap[stop.abbrev] = stop;
        
        // Draw Stop Marker on Map
        createStopMarker(stop);
      });
    }
  } catch (error) {
    console.error('Error fetching stops list:', error);
  }
}

// Draw Stop Markers
function createStopMarker(stop) {
  const isRed = stop.line === 'Red';
  renderStopMarkerIcon(stop.abbrev, isRed, false);
}

function renderStopMarkerIcon(abbrev, isRed, selected) {
  const stop = stopsMap[abbrev];
  if (!stop) return;

  const sizeClass = selected ? 'selected-stop' : '';
  const markerHtml = `<div class="luas-stop-marker ${isRed ? 'red-stop' : 'green-stop'} ${sizeClass}" id="marker-${abbrev}"></div>`;
  const iconSize = selected ? [18, 18] : [10, 10];
  const iconAnchor = selected ? [9, 9] : [5, 5];


  const stopIcon = L.divIcon({
    html: markerHtml,
    className: 'luas-stop-marker-wrapper',
    iconSize,
    iconAnchor
  });

  if (stopMarkers[abbrev]) {
    stopMarkers[abbrev].setIcon(stopIcon);
    return;
  }

  const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon })
    .bindTooltip(stop.name, {
      direction: 'top',
      offset: [0, -8],
      className: 'stop-tooltip-label'
    })
    .addTo(map);

  marker.on('click', () => { selectStop(abbrev); });
  stopMarkers[abbrev] = marker;
}

// 4. Draw Line Tracks
// ==========================================================================
function drawTracks() {
  // Draw polylines matching realistic Dublin track layout segment-by-segment
  const drawPathSegments = (abbrevs, colorGlow, cssColor) => {
    for (let i = 0; i < abbrevs.length - 1; i++) {
      const sA = abbrevs[i];
      const sB = abbrevs[i + 1];
      
      let coords = trackSegments[`${sA}_${sB}`];
      if (!coords && trackSegments[`${sB}_${sA}`]) {
        coords = [...trackSegments[`${sB}_${sA}`]].reverse();
      }
      
      if (!coords) {
        // Fallback to straight line if segment coords not loaded
        const stopA = stopsMap[sA];
        const stopB = stopsMap[sB];
        if (stopA && stopB) {
          coords = [[stopA.lat, stopA.lng], [stopB.lat, stopB.lng]];
        }
      }
      
      if (coords && coords.length > 0) {
        // Glowing track outline
        L.polyline(coords, {
          color: colorGlow,
          weight: 8,
          opacity: 0.15,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        // Core track line
        L.polyline(coords, {
          color: cssColor,
          weight: 3.5,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);
      }
    }
  };

  // Red tracks
  drawPathSegments(TRACKS_PATHS.red_main, 'var(--red-line)', 'var(--red-line)');
  drawPathSegments(TRACKS_PATHS.red_branch_tal, 'var(--red-line)', 'var(--red-line)');
  drawPathSegments(TRACKS_PATHS.red_branch_sag, 'var(--red-line)', 'var(--red-line)');
  drawPathSegments(TRACKS_PATHS.red_spur_con, 'var(--red-line)', 'var(--red-line)');

  // Green tracks
  drawPathSegments(TRACKS_PATHS.green_main, 'var(--green-line)', 'var(--green-line)');
  drawPathSegments(TRACKS_PATHS.green_north_loop, 'var(--green-line)', 'var(--green-line)');
}

// 5. Poll Trams & Active Position Updates
// ==========================================================================
async function pollTrams() {
  try {
    const response = await fetch('/api/trams');
    const data = await response.json();
    updateTramMarkers(data.trams);
  } catch (error) {
    console.error('Error polling active trams:', error);
  }
}

async function pollVehicleHistory() {
  try {
    const response = await fetch('/api/vehicle-history');
    const data = await response.json();
    knownVehicles = data.vehicles || [];
    vehicleHistoryMeta = data;
    renderTramFinder(data);
  } catch (error) {
    console.error('Error polling vehicle history:', error);
  }
}

function formatFeedTime(isoString) {
  if (!isoString) return 'Waiting for AVLS feed...';
  return `AVLS updated ${new Date(isoString).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatEta(dueMins) {
  if (dueMins === null || dueMins === undefined || Number.isNaN(Number(dueMins))) return 'ETA unknown';
  return dueMins <= 0.5 ? 'DUE' : `${Math.round(dueMins)} min`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function renderTramFinder(data = vehicleHistoryMeta) {
  const resultsList = document.getElementById('tram-results-list');
  const countBadge = document.getElementById('tram-finder-count');
  const lastUpdated = document.getElementById('tram-finder-last-updated');
  const query = document.getElementById('tram-search-input').value.trim().toLowerCase();

  countBadge.textContent = `${data.currentCount || 0} live`;
  lastUpdated.textContent = formatFeedTime(data.lastUpdated);

  let filtered = knownVehicles.filter(vehicle => {
    const lineKey = vehicle.line && vehicle.line.includes('Red') ? 'Red' : 'Green';
    const matchesLine = tramFinderLineFilter === 'All' || lineKey === tramFinderLineFilter;
    const matchesQuery = !query || vehicle.tramNumber.toLowerCase().includes(query);
    return matchesLine && matchesQuery;
  });

  if (filtered.length === 0) {
    resultsList.innerHTML = `
      <div class="tram-empty-state">
        <i class="fa-solid fa-train-subway"></i>
        No matching trams found.
      </div>
    `;
    return;
  }

  resultsList.innerHTML = filtered.slice(0, 80).map(vehicle => {
    const isRed = vehicle.line && vehicle.line.includes('Red');
    const statusText = vehicle.isCurrent
      ? `${formatEta(vehicle.dueMins)} to ${escapeHtml(vehicle.nextStopName)}`
      : `Last seen ${escapeHtml(vehicle.lastSeenDisplay || 'earlier')} near ${escapeHtml(vehicle.nextStopName)}`;
    const subText = vehicle.isCurrent
      ? `${escapeHtml(vehicle.direction)} to ${escapeHtml(vehicle.destination)}`
      : `${escapeHtml(vehicle.direction)} to ${escapeHtml(vehicle.destination)} at ${escapeHtml(vehicle.lastSeenDisplay || 'unknown time')}`;

    return `
      <button class="tram-result-row ${vehicle.isCurrent ? 'current' : 'stale'}" data-tram-number="${escapeHtml(vehicle.tramNumber)}">
        <span class="tram-number-pill ${isRed ? 'red' : 'green'}">${escapeHtml(vehicle.tramNumber)}</span>
        <span class="tram-result-main">
          <span class="tram-result-title">${statusText}</span>
          <span class="tram-result-subtitle">${subText}</span>
        </span>
        <span class="tram-current-state">${vehicle.isCurrent ? 'Live' : 'Last seen'}</span>
      </button>
    `;
  }).join('');

  resultsList.querySelectorAll('.tram-result-row').forEach(row => {
    row.addEventListener('click', () => focusTramOrLastStop(row.dataset.tramNumber));
  });
}

function focusTramOrLastStop(tramNumber) {
  const vehicle = knownVehicles.find(v => v.tramNumber === tramNumber);
  if (!vehicle) return;

  if (vehicle.isCurrent && tramMarkers[`avls_${tramNumber}`]) {
    const marker = tramMarkers[`avls_${tramNumber}`];
    map.flyTo(marker.getLatLng(), 15);
    marker.openTooltip();
    return;
  }

  if (vehicle.coords) {
    map.flyTo(vehicle.coords, 15);
    return;
  }

  const stop = stopsMap[vehicle.nextStopAbv || vehicle.nextStop];
  if (stop) {
    map.flyTo([stop.lat, stop.lng], 15);
  }
}

// Calculate geographic bearing in degrees (0=N, 90=E, 180=S, 270=W)
// Uses the proper spherical formula so east-west segments at 53°N are correct.
function getHeading(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

function getStopBySegmentEndpoint(endpointName, endpointAbv) {
  if (endpointAbv && stopsMap[endpointAbv]) return stopsMap[endpointAbv];
  return Object.values(stopsMap).find(s => s.name === endpointName);
}

// Update Map markers with smooth interpolation updates
function updateTramMarkers(trams) {
  const activeIds = new Set();
  const showTrams = document.getElementById('btn-toggle-trams').classList.contains('active');

  if (!showTrams) {
    for (const id in tramMarkers) {
      map.removeLayer(tramMarkers[id]);
    }
    tramMarkers = {};
    return;
  }

  trams.forEach(tram => {
    const lineKey = tram.line.includes('Red') ? 'Red' : 'Green';
    if (activeLineFilter && lineKey !== activeLineFilter) {
      if (tramMarkers[tram.id]) {
        map.removeLayer(tramMarkers[tram.id]);
        delete tramMarkers[tram.id];
      }
      return;
    }

    activeIds.add(tram.id);
    const isRed = tram.line.includes('Red');
    const tramLabel = tram.vehicleNumber ? `Tram ${tram.vehicleNumber}` : 'Luas tram';
    const etaLabel = tram.dueMins === null || tram.dueMins === undefined
      ? 'ETA unknown'
      : (tram.dueMins === 'DUE' ? 'DUE' : `${tram.dueMins}m`);

    // Use the segment's from→to endpoints for heading.
    // The segment already encodes direction of travel correctly.
    let heading = 0;
    if (tram.segment) {
      const fromStop = getStopBySegmentEndpoint(tram.segment.from, tram.segment.fromAbv);
      const toStop = getStopBySegmentEndpoint(tram.segment.to, tram.segment.toAbv);
      if (fromStop && toStop && (fromStop.lat !== toStop.lat || fromStop.lng !== toStop.lng)) {
        heading = getHeading(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
      }
    }

    const tooltipHtml = `
      <div style="font-family: var(--font-body); font-size:0.8rem; font-weight:600;">
        <span style="color:${isRed ? 'var(--red-line)' : 'var(--green-line)'}">&#9632;</span>
        ${escapeHtml(tramLabel)}<br>
        To ${escapeHtml(tram.destination)} (${etaLabel})
      </div>
    `;

    if (tramMarkers[tram.id]) {
      const marker = tramMarkers[tram.id];
      marker.setLatLng(tram.coords);
      const el = document.getElementById(`tram-icon-${tram.id}`);
      if (el) {
        el.style.transform = `rotate(${heading}deg)`;
      }
      marker.getTooltip().setContent(tooltipHtml);
    } else {
      const tramHtml = `
        <div class="luas-tram-icon ${isRed ? 'red-tram' : 'green-tram'}" id="tram-icon-${tram.id}" style="transform: rotate(${heading}deg);">
          <i class="fa-solid fa-arrow-up"></i>
        </div>
      `;
      const tramIcon = L.divIcon({
        html: `<div class="luas-tram-icon-wrapper">${tramHtml}</div>`,
        className: 'luas-tram-marker-wrapper',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker(tram.coords, { icon: tramIcon })
        .bindTooltip(tooltipHtml, {
          direction: 'top',
          offset: [0, -12],
          className: 'tram-tooltip-label'
        })
        .addTo(map);

      tramMarkers[tram.id] = marker;
    }
  });

  for (const id in tramMarkers) {
    if (!activeIds.has(id)) {
      map.removeLayer(tramMarkers[id]);
      delete tramMarkers[id];
    }
  }
}
// 6. Poll status & Live disruption ticker info
// ==========================================================================
function isNormalAlert(text) {
  return /operating normally|running normally|no disruptions/i.test(text || '');
}

function findLineAlert(alerts, lineName) {
  return (alerts || []).find(alert => alert.toLowerCase().includes(lineName.toLowerCase()));
}

function updateLineAlertBanner(elementId, lineName, alertText, lineClass) {
  const banner = document.getElementById(elementId);
  if (!banner) return;

  const normal = !alertText || isNormalAlert(alertText);
  const text = normal
    ? `${lineName}: Operating normally`
    : alertText;

  // Only show warning icon & red styling for real disruptions
  banner.className = `line-alert-banner ${lineClass} ${normal ? 'normal' : 'warning'}`;
  banner.innerHTML = normal
    ? `<i class="fa-solid fa-circle-check status-icon"></i><span>${escapeHtml(text)}</span>`
    : `<i class="fa-solid fa-triangle-exclamation status-icon"></i><span>${escapeHtml(text)}</span>`;
}

function updateLineAlerts(alerts) {
  updateLineAlertBanner('red-line-alert', 'Red Line', findLineAlert(alerts, 'Red Line'), 'red');
  updateLineAlertBanner('green-line-alert', 'Green Line', findLineAlert(alerts, 'Green Line'), 'green');
}

async function pollStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();

    // 1. Update Diagnostics Panel
    const apiBadge = document.getElementById('api-status-badge');
    const modeBadge = document.getElementById('mode-status-badge');

    if (status.apiConnected) {
      apiBadge.textContent = 'Connected';
      apiBadge.className = 'badge badge-connected';
    } else {
      apiBadge.textContent = 'No Response';
      apiBadge.className = 'badge badge-disconnected';
    }

    if (status.currentMode === 'live') {
      modeBadge.textContent = 'Live Feed';
      modeBadge.className = 'badge badge-connected';
    } else {
      modeBadge.textContent = 'Simulated';
      modeBadge.className = 'badge badge-sim';
    }

    // Update active diagnostic button states
    // In server, config.mode is reflected
    // We don't expose config directly, but we can match currentMode
    // Let's highlight based on local active selection
    // (Handled directly in click handler, but poll checks match)

    updateLineAlerts(status.activeAlerts || []);

  } catch (error) {
    console.error('Error fetching system status:', error);
  }
}

// 7. Select Stop / View live Arrivals
// ==========================================================================
async function selectStop(abbrev) {
  const prevSelected = selectedStopAbbrev;
  selectedStopAbbrev = abbrev;
  const stop = stopsMap[abbrev];
  if (!stop) return;

  // 1. Visually select marker on map — redraw icons so selected = hollow ring, others = filled dot
  if (prevSelected && prevSelected !== abbrev) {
    const prevStop = stopsMap[prevSelected];
    if (prevStop) renderStopMarkerIcon(prevSelected, prevStop.line === 'Red', false);
  }
  renderStopMarkerIcon(abbrev, stop.line === 'Red', true);
  if (stopMarkers[abbrev] && !map.hasLayer(stopMarkers[abbrev])) {
    stopMarkers[abbrev].addTo(map);
  }

  // Hide empty state and show departures content
  document.getElementById('departures-empty-placeholder').style.display = 'none';
  document.getElementById('departures-real-content').style.display = 'flex';
  // Add has-stop to constrain height so tram-finder remains visible
  document.getElementById('station-departures-card').classList.add('has-stop');


  // Load static stop info
  document.getElementById('selected-stop-name').textContent = stop.name;
  document.getElementById('selected-stop-abbrev').textContent = stop.abbrev;

  // Set line indicators
  const card = document.getElementById('station-departures-card');
  card.style.borderTop = stop.line === 'Red' ? '4px solid var(--red-line)' : '4px solid var(--green-line)';

  // Show station features
  document.getElementById('feature-park-ride').style.display = stop.isParkRide ? 'flex' : 'none';
  document.getElementById('feature-cycle').style.display = stop.isCycleRide ? 'flex' : 'none';

  // Fetch forecast arrivals
  await fetchStopForecast(abbrev);
}

// Fetch departures board for selected stop
async function fetchStopForecast(abbrev) {
  document.getElementById('departures-loading').style.display = 'flex';
  document.getElementById('timetable-inbound-list').style.display = 'none';
  document.getElementById('timetable-outbound-list').style.display = 'none';
  document.getElementById('timetable-terminating-list').style.display = 'none';
  document.getElementById('departures-none-msg').style.display = 'none';

  try {
    const response = await fetch(`/api/forecast/${abbrev}`);
    const data = await response.json();
    
    // Clear loading
    document.getElementById('departures-loading').style.display = 'none';

    // Group arrivals by inbound/outbound/terminating
    const inboundTrams = data.trams.filter(t => t.direction === 'Inbound');
    const outboundTrams = data.trams.filter(t => t.direction === 'Outbound');
    const terminatingTrams = data.trams.filter(t => t.direction === 'Terminating');

    const hasTerminating = terminatingTrams.length > 0;
    const tabTerminating = document.getElementById('tab-terminating');
    if (hasTerminating) {
      tabTerminating.style.display = 'flex';
    } else {
      tabTerminating.style.display = 'none';
      if (currentTab === 'Terminating') {
        currentTab = 'Inbound';
        document.getElementById('tab-inbound').classList.add('active');
        document.getElementById('tab-outbound').classList.remove('active');
        tabTerminating.classList.remove('active');
      }
    }

    // Populate lists
    const lineTheme = stopMarkers[abbrev] ? stopsMap[abbrev].line : 'Red';
    populateTimetableList('timetable-inbound-list', inboundTrams, lineTheme);
    populateTimetableList('timetable-outbound-list', outboundTrams, lineTheme);
    populateTimetableList('timetable-terminating-list', terminatingTrams, lineTheme);

    // Show active tab
    showActiveTimetableTab();

    // Check if all lists are empty
    if (inboundTrams.length === 0 && outboundTrams.length === 0 && terminatingTrams.length === 0) {
      document.getElementById('departures-none-msg').style.display = 'flex';
    }

  } catch (error) {
    console.error('Error fetching stop forecast:', error);
    document.getElementById('departures-loading').style.display = 'none';
    document.getElementById('departures-none-msg').style.display = 'flex';
    document.getElementById('departures-none-msg').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error loading forecast.`;
  }
}

// Construct dynamic arrival list rows
function populateTimetableList(elementId, trams, lineTheme) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';

  if (trams.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 20px 0; color:var(--text-secondary); font-size:0.85rem;">
        No upcoming scheduled trams.
      </div>
    `;
    return;
  }

  trams.forEach(tram => {
    const row = document.createElement('div');
    row.className = 'timetable-row';
    
    const isDue = typeof tram.dueMins === 'string' && tram.dueMins.toUpperCase() === 'DUE' || tram.dueMins === 0.5 || tram.dueMins <= 0;
    const minutesDisplay = isDue ? 'DUE' : Math.round(tram.dueMins);

    const etaDisplay = tram.eta ? `<span class="train-eta-clock">${tram.eta}</span>` : '';

    row.innerHTML = `
      <div class="train-dest-info">
        <i class="fa-solid fa-train-tram train-dest-icon" style="color:${lineTheme === 'Red' ? 'var(--red-line)' : 'var(--green-line)'}"></i>
        <span class="train-dest-name">${tram.destination}</span>
      </div>
      <div class="train-eta-info">
        <span class="train-eta-val ${isDue ? 'due' : ''}">${minutesDisplay}</span>
        ${isDue ? '' : '<span class="train-eta-unit">min</span>'}
        ${etaDisplay}
      </div>
    `;
    container.appendChild(row);
  });
}

function showActiveTimetableTab() {
  const inboundList = document.getElementById('timetable-inbound-list');
  const outboundList = document.getElementById('timetable-outbound-list');
  const terminatingList = document.getElementById('timetable-terminating-list');

  inboundList.style.display = currentTab === 'Inbound' ? 'flex' : 'none';
  outboundList.style.display = currentTab === 'Outbound' ? 'flex' : 'none';
  terminatingList.style.display = currentTab === 'Terminating' ? 'flex' : 'none';
}

// Local second-by-second countdown logic so ETAs count down smoothly
function updateDeparturesCountdownLocal() {
  if (!selectedStopAbbrev) return;
  // To avoid constant flickering server hits, we fetch stop forecasts every 8s
  // But we can let the UI count down the dueMins values in-between!
  // Simple check: we just trigger a poll to the server forecast at longer intervals
  if (Date.now() % 8000 < 1000) {
    fetchStopForecast(selectedStopAbbrev);
  }
}

// 8. Search & Filters Event Listeners Setup
// ==========================================================================
function setupUIEventListeners() {
  const searchInput = document.getElementById('station-search-input');
  const suggestionsBox = document.getElementById('search-suggestions');
  const clearBtn = document.getElementById('btn-clear-search');
  const tramSearchInput = document.getElementById('tram-search-input');
  const clearTramSearchBtn = document.getElementById('btn-clear-tram-search');

  // Input listener for search box
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    
    if (query === '') {
      suggestionsBox.style.display = 'none';
      clearBtn.style.display = 'none';
      return;
    }

    clearBtn.style.display = 'block';

    // Find matching stops
    const matches = [];
    for (const key in stopsMap) {
      const stop = stopsMap[key];
      if (stop.name.toLowerCase().includes(query) || stop.abbrev.toLowerCase().includes(query)) {
        matches.push(stop);
      }
    }

    // Display suggestions
    suggestionsBox.innerHTML = '';
    if (matches.length > 0) {
      matches.slice(0, 5).forEach(match => {
        const li = document.createElement('li');
        const isRed = match.line === 'Red';
        li.innerHTML = `
          <span class="suggestion-name">${match.name}</span>
          <span class="suggestion-line" style="background-color:${isRed ? 'var(--red-line-bg)' : 'var(--green-line-bg)'}; color:${isRed ? 'var(--red-line)' : 'var(--green-line)'}">${match.line} Line</span>
        `;
        li.addEventListener('click', () => {
          searchInput.value = match.name;
          suggestionsBox.style.display = 'none';
          selectStop(match.abbrev);
          
          // Fly map to stop coordinates
          map.flyTo([match.lat, match.lng], 15);
        });
        suggestionsBox.appendChild(li);
      });
      suggestionsBox.style.display = 'block';
    } else {
      suggestionsBox.innerHTML = '<li style="color:var(--text-secondary); cursor:default;">No matches found</li>';
      suggestionsBox.style.display = 'block';
    }
  });

  // Clear search button
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    suggestionsBox.style.display = 'none';
    clearBtn.style.display = 'none';
  });

  tramSearchInput.addEventListener('input', () => {
    clearTramSearchBtn.style.display = tramSearchInput.value.trim() ? 'block' : 'none';
    renderTramFinder();
  });

  clearTramSearchBtn.addEventListener('click', () => {
    tramSearchInput.value = '';
    clearTramSearchBtn.style.display = 'none';
    renderTramFinder();
  });

  const setTramFilter = (filter, activeButton) => {
    tramFinderLineFilter = filter;
    document.querySelectorAll('.tram-filter-btn').forEach(btn => btn.classList.remove('active'));
    activeButton.classList.add('active');
    renderTramFinder();
  };

  document.getElementById('tram-filter-all').addEventListener('click', (e) => setTramFilter('All', e.currentTarget));
  document.getElementById('tram-filter-red').addEventListener('click', (e) => setTramFilter('Red', e.currentTarget));
  document.getElementById('tram-filter-green').addEventListener('click', (e) => setTramFilter('Green', e.currentTarget));

  // Hide suggestions dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== suggestionsBox) {
      suggestionsBox.style.display = 'none';
    }
  });

  // Center button inside departures panel
  document.getElementById('btn-fly-to-stop').addEventListener('click', () => {
    if (selectedStopAbbrev) {
      const stop = stopsMap[selectedStopAbbrev];
      if (stop) map.flyTo([stop.lat, stop.lng], 15);
    }
  });

  // Tab buttons inbound/outbound/terminating
  const tabInbound = document.getElementById('tab-inbound');
  const tabOutbound = document.getElementById('tab-outbound');
  const tabTerminating = document.getElementById('tab-terminating');

  const selectTab = (tabName, activeBtn) => {
    currentTab = tabName;
    [tabInbound, tabOutbound, tabTerminating].forEach(btn => btn.classList.remove('active'));
    activeBtn.classList.add('active');
    showActiveTimetableTab();
  };

  tabInbound.addEventListener('click', () => selectTab('Inbound', tabInbound));
  tabOutbound.addEventListener('click', () => selectTab('Outbound', tabOutbound));
  tabTerminating.addEventListener('click', () => selectTab('Terminating', tabTerminating));

  // Mode select buttons on diagnosis card
  const btnAuto = document.getElementById('btn-mode-auto');
  const btnLive = document.getElementById('btn-mode-live');
  const btnSim = document.getElementById('btn-mode-sim');

  const setDiagnosticModeButtons = (activeBtn) => {
    [btnAuto, btnLive, btnSim].forEach(btn => btn.classList.remove('active'));
    activeBtn.classList.add('active');
  };

  btnAuto.addEventListener('click', async () => {
    setDiagnosticModeButtons(btnAuto);
    await fetch('/api/mode/auto');
    pollStatus();
    pollTrams();
  });

  btnLive.addEventListener('click', async () => {
    setDiagnosticModeButtons(btnLive);
    await fetch('/api/mode/live');
    pollStatus();
    pollTrams();
  });

  btnSim.addEventListener('click', async () => {
    setDiagnosticModeButtons(btnSim);
    await fetch('/api/mode/simulation');
    pollStatus();
    pollTrams();
  });

  // Line quick filters
  const btnRedFilter = document.getElementById('btn-select-red-line');
  const btnGreenFilter = document.getElementById('btn-select-green-line');

  btnRedFilter.addEventListener('click', () => {
    if (activeLineFilter === 'Red') {
      activeLineFilter = null;
      btnRedFilter.classList.remove('active-filter');
      // show all stop markers
      for (const abbrev in stopMarkers) {
        stopMarkers[abbrev].addTo(map);
      }
    } else {
      activeLineFilter = 'Red';
      btnRedFilter.classList.add('active-filter');
      btnGreenFilter.classList.remove('active-filter');
      // filter markers
      for (const abbrev in stopMarkers) {
        const s = stopsMap[abbrev];
        if (s.line === 'Red') {
          stopMarkers[abbrev].addTo(map);
        } else {
          map.removeLayer(stopMarkers[abbrev]);
        }
      }
    }
    pollTrams();
  });

  btnGreenFilter.addEventListener('click', () => {
    if (activeLineFilter === 'Green') {
      activeLineFilter = null;
      btnGreenFilter.classList.remove('active-filter');
      for (const abbrev in stopMarkers) {
        stopMarkers[abbrev].addTo(map);
      }
    } else {
      activeLineFilter = 'Green';
      btnGreenFilter.classList.add('active-filter');
      btnRedFilter.classList.remove('active-filter');
      for (const abbrev in stopMarkers) {
        const s = stopsMap[abbrev];
        if (s.line === 'Green') {
          stopMarkers[abbrev].addTo(map);
        } else {
          map.removeLayer(stopMarkers[abbrev]);
        }
      }
    }
    pollTrams();
  });

  // Toggle Trams float button on map overlay
  const btnToggleTrams = document.getElementById('btn-toggle-trams');
  btnToggleTrams.addEventListener('click', () => {
    btnToggleTrams.classList.toggle('active');
    pollTrams();
  });

  // Toggle Theme float button on map overlay
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  btnToggleTheme.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    if (isLight) {
      btnToggleTheme.innerHTML = '<i class="fa-solid fa-moon"></i>';
      btnToggleTheme.title = 'Switch to dark theme';
      tileLayer.setUrl(MAP_TILES_LIGHT);
    } else {
      btnToggleTheme.innerHTML = '<i class="fa-solid fa-sun"></i>';
      btnToggleTheme.title = 'Switch to light theme';
      tileLayer.setUrl(MAP_TILES_DARK);
    }
  });
}
