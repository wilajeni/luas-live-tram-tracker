const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchAllAVLSData, compileVehiclePositions } = require('./avls_module');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load stops data
const stopsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'stops.json')));
const stopsMap = {};
for (const line in stopsData) {
  stopsData[line].forEach(stop => {
    stopsMap[stop.abbrev] = stop;
  });
}

// -------------------------------------------------------------
// GEOGRAPHIC & ROUTE DEFINITIONS
// -------------------------------------------------------------

// Calculate distance in meters using Haversine formula
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estimate travel time between two stops in seconds
// Speed is approx 25 km/h = 6.94 m/s. Plus 20s stop dwell time.
function getTravelTime(stopA, stopB) {
  const sA = stopsMap[stopA];
  const sB = stopsMap[stopB];
  if (!sA || !sB) return 120; // fallback 2 mins
  const dist = getDistance(sA.lat, sA.lng, sB.lat, sB.lng);
  return Math.max(45, Math.round(dist / 6.94) + 20); // min 45 seconds
}

// Defined routes for Red and Green lines
const ROUTES = {
  // Red Line Outbound (Westbound)
  red_outbound_tallaght: ['TPT', 'SDK', 'MYS', 'GDK', 'BUS', 'ABB', 'JER', 'FOU', 'SMI', 'MUS', 'HEU', 'JAM', 'FAT', 'RIA', 'SUI', 'GOL', 'DRI', 'BLA', 'BLU', 'KYL', 'RED', 'KIN', 'BEL', 'COO', 'HOS', 'TAL'],
  red_outbound_saggart: ['TPT', 'SDK', 'MYS', 'GDK', 'BUS', 'ABB', 'JER', 'FOU', 'SMI', 'MUS', 'HEU', 'JAM', 'FAT', 'RIA', 'SUI', 'GOL', 'DRI', 'BLA', 'BLU', 'KYL', 'RED', 'KIN', 'BEL', 'FET', 'CVN', 'CIT', 'FOR', 'SAG'],
  red_outbound_connolly: ['CON', 'ABB', 'JER', 'FOU', 'SMI', 'MUS', 'HEU', 'JAM', 'FAT', 'RIA', 'SUI', 'GOL', 'DRI', 'BLA', 'BLU', 'KYL', 'RED', 'KIN', 'BEL', 'COO', 'HOS', 'TAL'], // Connolly spur

  // Red Line Inbound (Eastbound)
  red_inbound_thepoint_tal: ['TAL', 'HOS', 'COO', 'BEL', 'KIN', 'RED', 'KYL', 'BLU', 'BLA', 'DRI', 'GOL', 'SUI', 'RIA', 'FAT', 'JAM', 'HEU', 'MUS', 'SMI', 'FOU', 'JER', 'ABB', 'BUS', 'GDK', 'MYS', 'SDK', 'TPT'],
  red_inbound_thepoint_sag: ['SAG', 'FOR', 'CIT', 'CVN', 'FET', 'BEL', 'KIN', 'RED', 'KYL', 'BLU', 'BLA', 'DRI', 'GOL', 'SUI', 'RIA', 'FAT', 'JAM', 'HEU', 'MUS', 'SMI', 'FOU', 'JER', 'ABB', 'BUS', 'GDK', 'MYS', 'SDK', 'TPT'],
  red_inbound_connolly: ['TAL', 'HOS', 'COO', 'BEL', 'KIN', 'RED', 'KYL', 'BLU', 'BLA', 'DRI', 'GOL', 'SUI', 'RIA', 'FAT', 'JAM', 'HEU', 'MUS', 'SMI', 'FOU', 'JER', 'ABB', 'CON'],

  // Green Line Outbound (Southbound)
  green_outbound_bridesglen: ['BRO', 'CAB', 'PHI', 'GRA', 'BRD', 'DOM', 'PAR', 'MAR', 'TRY', 'DAW', 'STS', 'HAR', 'CHA', 'RAN', 'BEE', 'COW', 'MIL', 'WIN', 'DUN', 'BAL', 'KIL', 'STI', 'SAN', 'CPK', 'GLE', 'GAL', 'LEO', 'BAW', 'CCK', 'LAU', 'CHE', 'BRI'],
  green_outbound_sandyford: ['BRO', 'CAB', 'PHI', 'GRA', 'BRD', 'DOM', 'PAR', 'MAR', 'TRY', 'DAW', 'STS', 'HAR', 'CHA', 'RAN', 'BEE', 'COW', 'MIL', 'WIN', 'DUN', 'BAL', 'KIL', 'STI', 'SAN'],

  // Green Line Inbound (Northbound)
  green_inbound_broombridge: ['BRI', 'CHE', 'LAU', 'CCK', 'BAW', 'LEO', 'GAL', 'GLE', 'CPK', 'SAN', 'STI', 'KIL', 'BAL', 'DUN', 'WIN', 'MIL', 'COW', 'BEE', 'RAN', 'CHA', 'HAR', 'STS', 'DAW', 'WES', 'OGP', 'OUP', 'PAR', 'DOM', 'BRD', 'GRA', 'PHI', 'CAB', 'BRO'],
  green_inbound_broombridge_san: ['SAN', 'STI', 'KIL', 'BAL', 'DUN', 'WIN', 'MIL', 'COW', 'BEE', 'RAN', 'CHA', 'HAR', 'STS', 'DAW', 'WES', 'OGP', 'OUP', 'PAR', 'DOM', 'BRD', 'GRA', 'PHI', 'CAB', 'BRO']
};

// Auto-compile segment metadata database
const SEGMENT_METADATA = {};
for (const routeKey in ROUTES) {
  const path = ROUTES[routeKey];
  for (let i = 0; i < path.length - 1; i++) {
    const sA = path[i];
    const sB = path[i + 1];
    const key = `${sA}_${sB}`;
    if (!SEGMENT_METADATA[key]) {
      const travelTime = getTravelTime(sA, sB);
      SEGMENT_METADATA[key] = {
        from: sA,
        to: sB,
        travelTime: travelTime, // in seconds
        distance: getDistance(stopsMap[sA].lat, stopsMap[sA].lng, stopsMap[sB].lat, stopsMap[sB].lng)
      };
    }
  }
}

function findBestRoutePath(line, direction, destName) {
  const dest = (destName || '').toLowerCase();
  const normalizedDirection = (direction || '').toLowerCase();

  if (line === 'Luas Red Line') {
    if (normalizedDirection === 'outbound') {
      if (dest.includes('saggart')) return ROUTES.red_outbound_saggart;
      if (dest.includes('connolly')) return ROUTES.red_outbound_connolly;
      return ROUTES.red_outbound_tallaght;
    }

    if (dest.includes('connolly')) return ROUTES.red_inbound_connolly;
    if (dest.includes('saggart')) return ROUTES.red_inbound_thepoint_sag;
    return ROUTES.red_inbound_thepoint_tal;
  }

  if (normalizedDirection === 'outbound') {
    if (dest.includes('sandyford')) return ROUTES.green_outbound_sandyford;
    return ROUTES.green_outbound_bridesglen;
  }

  if (dest.includes('sandyford')) return ROUTES.green_inbound_broombridge_san;
  return ROUTES.green_inbound_broombridge;
}

function normalizeDueMins(dueMins) {
  if (dueMins === null || dueMins === undefined || Number.isNaN(Number(dueMins))) return null;
  return Number(dueMins);
}

function estimateVehicleCoordinates(vehicle) {
  const nextStopAbv = vehicle.nextStop;
  const toStop = stopsMap[nextStopAbv];
  if (!toStop) return null;

  const routePath = findBestRoutePath(vehicle.line, vehicle.direction, vehicle.destination);
  const nextStopIdx = routePath.indexOf(nextStopAbv);
  const dueMins = normalizeDueMins(vehicle.dueMins);

  let fromStopAbv = nextStopAbv;
  let headingFromAbv = nextStopAbv;
  let headingToAbv = nextStopAbv;
  let progress = 0;

  if (nextStopIdx > 0) {
    fromStopAbv = routePath[nextStopIdx - 1];
    headingFromAbv = fromStopAbv;
    headingToAbv = nextStopAbv;
    const segInfo = SEGMENT_METADATA[`${fromStopAbv}_${nextStopAbv}`];

    if (segInfo && dueMins !== null) {
      const travelTimeMins = segInfo.travelTime / 60;
      if (dueMins <= 0.5) {
        fromStopAbv = nextStopAbv;
        headingFromAbv = nextStopAbv;
        headingToAbv = routePath[nextStopIdx + 1] || nextStopAbv;
      } else if (dueMins < travelTimeMins) {
        progress = Math.max(0.05, Math.min(0.95, (travelTimeMins - dueMins) / travelTimeMins));
      } else {
        progress = 0.05;
      }
    }
  }

  const fromStop = stopsMap[fromStopAbv] || toStop;
  const coords = [
    fromStop.lat + progress * (toStop.lat - fromStop.lat),
    fromStop.lng + progress * (toStop.lng - fromStop.lng)
  ];

  const headingFromStop = stopsMap[headingFromAbv] || fromStop;
  const headingToStop = stopsMap[headingToAbv] || toStop;

  return {
    coords,
    progress,
    segment: headingFromStop && headingToStop ? {
      from: headingFromStop.name,
      to: headingToStop.name,
      fromAbv: headingFromAbv,
      toAbv: headingToAbv
    } : null
  };
}

function vehicleToMapTram(vehicle) {
  const estimate = estimateVehicleCoordinates(vehicle);
  const stop = stopsMap[vehicle.nextStop];
  if (!estimate || !stop) return null;
  const dueMins = normalizeDueMins(vehicle.dueMins);

  return {
    id: `avls_${vehicle.tramNumber}`,
    vehicleNumber: vehicle.tramNumber,
    line: vehicle.line,
    direction: vehicle.direction,
    destination: vehicle.destination,
    nextStop: stop.name,
    nextStopAbv: vehicle.nextStop,
    dueMins: dueMins === null ? null : (dueMins <= 0.5 ? 'DUE' : Math.round(dueMins)),
    coords: estimate.coords,
    progress: estimate.progress,
    segment: estimate.segment,
    source: 'avls'
  };
}

function getCurrentAVLSMapTrams() {
  return Object.values(AVLS_VEHICLE_MAP)
    .map(vehicleToMapTram)
    .filter(Boolean);
}

function enrichVehicleForFinder(vehicle, isCurrent = true) {
  const stop = stopsMap[vehicle.nextStop] || null;
  const estimate = estimateVehicleCoordinates(vehicle);
  return {
    ...vehicle,
    id: `avls_${vehicle.tramNumber}`,
    vehicleNumber: vehicle.tramNumber,
    isCurrent,
    nextStopAbv: vehicle.nextStop,
    nextStopName: stop ? stop.name : vehicle.nextStop,
    dueMins: normalizeDueMins(vehicle.dueMins),
    coords: estimate ? estimate.coords : null,
    segment: estimate ? estimate.segment : null,
    lastSeenAt: vehicle.lastSeenAt || null,
    lastSeenDisplay: vehicle.lastSeenDisplay || null
  };
}

function formatLocalTime(date) {
  return new Intl.DateTimeFormat('en-IE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Dublin'
  }).format(date);
}

function saveVehicleHistory() {
  fs.writeFile(VEHICLE_HISTORY_PATH, JSON.stringify(VEHICLE_HISTORY, null, 2), (err) => {
    if (err) console.error('Could not save vehicle history:', err.message);
  });
}

function getAVLSForecastForStop(stopAbbrev) {
  const stop = stopsMap[stopAbbrev];
  if (!stop) return null;

  const trams = [];
  Object.values(AVLS_VEHICLE_MAP).forEach(vehicle => {
    const sighting = (vehicle.sightings || []).find(item => item.stopAbbrev === stopAbbrev);
    if (!sighting) return;

    const dueMins = normalizeDueMins(sighting.dueMins);
    if (dueMins === null) return;

    trams.push({
      direction: sighting.direction,
      destination: sighting.destination,
      dueMins: dueMins <= 0.5 ? 0.5 : Math.round(dueMins),
      vehicleNumber: vehicle.tramNumber,
      source: 'avls'
    });
  });

  trams.sort((a, b) => a.dueMins - b.dueMins);

  return {
    stopName: stop.name,
    stopAbv: stopAbbrev,
    message: trams.length > 0 ? 'Live AVLS vehicle predictions.' : 'No live departures available.',
    trams
  };
}

// -------------------------------------------------------------
// APP CONFIG & SYSTEM STATE
// -------------------------------------------------------------
const CONFIG = {
  mode: 'auto', // 'auto' (checks live first), 'live' (force live), 'simulation' (force simulation)
  pollIntervalMs: 20000 // poll live data every 20s
};

let SYSTEM_STATUS = {
  currentMode: 'simulation',
  apiConnected: false,
  lastPollTime: null,
  activeAlerts: []
};

// Global data stores
let LIVE_TRAMS = [];
let LIVE_DEPARTURES = {}; // Keyed by stop abbrev

// AVLS Vehicle tracking (real vehicle numbers from analysis page)
let AVLS_VEHICLE_MAP = {};       // tramNumber -> vehicle position data
let AVLS_LAST_POLL = null;
const AVLS_POLL_INTERVAL_MS = 30000; // poll every 30s
const VEHICLE_HISTORY_PATH = path.join(__dirname, 'vehicle_history.json');
let VEHICLE_HISTORY = {};

try {
  if (fs.existsSync(VEHICLE_HISTORY_PATH)) {
    VEHICLE_HISTORY = JSON.parse(fs.readFileSync(VEHICLE_HISTORY_PATH, 'utf8'));
  }
} catch (err) {
  console.warn('Could not load vehicle history:', err.message);
  VEHICLE_HISTORY = {};
}

// -------------------------------------------------------------
// REAL-TIME AVLS TRACKING ALGORITHM
// -------------------------------------------------------------

function parseXMLForecast(xmlString) {
  const result = {
    stopName: '',
    stopAbv: '',
    message: '',
    trams: []
  };

  const stopInfoMatch = xmlString.match(/<stopInfo created="[^"]+" stop="([^"]+)" stopAbv="([^"]+)"/);
  if (stopInfoMatch) {
    result.stopName = stopInfoMatch[1];
    result.stopAbv = stopInfoMatch[2];
  }

  const messageMatch = xmlString.match(/<message>([^<]*)<\/message>/);
  if (messageMatch) {
    result.message = messageMatch[1];
  }

  // Parse directions: <direction name="Inbound">...</direction>
  const dirRegex = /<direction name="([^"]+)">([\s\S]*?)<\/direction>/g;
  let dirMatch;
  while ((dirMatch = dirRegex.exec(xmlString)) !== null) {
    const direction = dirMatch[1]; // 'Inbound' or 'Outbound'
    const content = dirMatch[2];
    
    // Parse trams in this direction: <tram destination="Destination" dueMins="Mins" />
    const tramRegex = /<tram destination="([^"]+)" dueMins="([^"]*)"\s*\/>/g;
    let tramMatch;
    while ((tramMatch = tramRegex.exec(content)) !== null) {
      const dest = tramMatch[1];
      const dueStr = tramMatch[2].trim();
      
      if (dest === 'See news for information') continue;
      
      let dueMinutes = null;
      if (dueStr.toUpperCase() === 'DUE') {
        dueMinutes = 0.5;
      } else if (dueStr !== '') {
        dueMinutes = parseFloat(dueStr);
      }

      if (dueMinutes !== null) {
        result.trams.push({
          direction: direction, // 'Inbound' or 'Outbound'
          destination: dest,
          dueMins: dueMinutes
        });
      }
    }
  }

  return result;
}

// Fetch all forecasts in parallel with rate control
async function fetchAllForecasts() {
  const allAbbrevs = Object.keys(stopsMap);
  const fetchedData = {};
  const alerts = new Set();

  console.log(`Polling live forecasts for ${allAbbrevs.length} stops...`);

  // Simple promise-based HTTP helper
  const fetchSingleStop = (abv) => {
    return new Promise((resolve) => {
      const url = `https://luasforecasts.rpa.ie/xml/get.ashx?action=forecast&stop=${abv}&encrypt=false`;
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          resolve({ abv, error: `Status code ${res.statusCode}` });
          return;
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ abv, data }));
      }).on('error', err => {
        resolve({ abv, error: err.message });
      });
    });
  };

  // Chunk requests to avoid overwhelming the server
  const chunkSize = 15;
  for (let i = 0; i < allAbbrevs.length; i += chunkSize) {
    const chunk = allAbbrevs.slice(i, i + chunkSize);
    const promises = chunk.map(abv => fetchSingleStop(abv));
    const chunkResults = await Promise.all(promises);
    
    chunkResults.forEach(res => {
      if (res.data) {
        try {
          const parsed = parseXMLForecast(res.data);
          fetchedData[res.abv] = parsed;
          if (parsed.message) {
            alerts.add(parsed.message);
          }
        } catch (e) {
          console.error(`Error parsing XML for ${res.abv}:`, e.message);
        }
      }
    });
    // Tiny delay between chunks
    await new Promise(r => setTimeout(r, 100));
  }

  SYSTEM_STATUS.activeAlerts = Array.from(alerts);
  SYSTEM_STATUS.lastPollTime = new Date().toISOString();
  return fetchedData;
}

// Tracking State Reconstruct Engine
function processLiveTrams(fetchedData) {
  const compiledTrams = [];

  // Iterate over Red and Green Lines
  for (const lineName in stopsData) {
    const isRedLine = lineName.includes('Red');
    const directions = ['Inbound', 'Outbound'];

    directions.forEach(direction => {
      // To find chains, we need to list stops along the route sequence
      // We'll take the longest path for tracing
      const tracePath = isRedLine 
        ? (direction === 'Outbound' ? ROUTES.red_outbound_saggart : ROUTES.red_inbound_thepoint_sag)
        : (direction === 'Outbound' ? ROUTES.green_outbound_bridesglen : ROUTES.green_inbound_broombridge);

      // Extract all forecasts for this specific line & direction
      const forecasts = [];
      tracePath.forEach(abv => {
        const data = fetchedData[abv];
        if (!data) return;
        data.trams.forEach(t => {
          if (t.direction === direction) {
            forecasts.push({
              stopAbbrev: abv,
              destination: t.destination,
              dueMins: t.dueMins
            });
          }
        });
      });

      // Group forecasts into matching chains (wave propagation of ETAs)
      // A tram is a chain of arrivals moving forward down the path
      // Sort forecasts by dueMins ascending
      forecasts.sort((a, b) => a.dueMins - b.dueMins);

      const usedForecasts = new Set();

      forecasts.forEach(fc => {
        const fcKey = `${fc.stopAbbrev}_${fc.destination}_${fc.dueMins}`;
        if (usedForecasts.has(fcKey)) return;

        // Try to construct a chain representing this single tram
        const chain = [fc];
        usedForecasts.add(fcKey);

        const routePath = findBestRoutePath(lineName, direction, fc.destination);
        const stopIndexInRoute = routePath.indexOf(fc.stopAbbrev);
        if (stopIndexInRoute === -1) return; // Stop is not on our route path

        // Try to trace downstream (to subsequent stops in the routePath)
        let currentDue = fc.dueMins;
        let currentStopIdx = stopIndexInRoute;

        for (let j = currentStopIdx + 1; j < routePath.length; j++) {
          const nextStopAbv = routePath[j];
          const segKey = `${routePath[j-1]}_${nextStopAbv}`;
          const segInfo = SEGMENT_METADATA[segKey];
          if (!segInfo) break;

          const travelMins = segInfo.travelTime / 60;
          const expectedDue = currentDue + travelMins;

          // Look for an unused forecast at nextStopAbv that matches this expectedDue time (+/- 3.5 mins)
          const match = forecasts.find(f => {
            const fKey = `${f.stopAbbrev}_${f.destination}_${f.dueMins}`;
            if (usedForecasts.has(fKey)) return false;
            if (f.stopAbbrev !== nextStopAbv) return false;
            // Dest should match roughly
            if (f.destination !== fc.destination) return false;
            return Math.abs(f.dueMins - expectedDue) <= 3.5;
          });

          if (match) {
            chain.push(match);
            usedForecasts.add(`${match.stopAbbrev}_${match.destination}_${match.dueMins}`);
            currentDue = match.dueMins;
            currentStopIdx = j;
          }
        }

        // We have our chain representing a physical tram!
        // Let's locate the tram on its segment.
        // The first stop in the chain is the closest upcoming stop.
        const nextStopAbv = chain[0].stopAbbrev;
        const dueMins = chain[0].dueMins;
        const nextStopIdx = routePath.indexOf(nextStopAbv);
        
        let fromStopAbv = null;
        let toStopAbv = nextStopAbv;
        let progress = 0;

        if (nextStopIdx > 0) {
          fromStopAbv = routePath[nextStopIdx - 1];
          const segKey = `${fromStopAbv}_${toStopAbv}`;
          const segInfo = SEGMENT_METADATA[segKey];
          
          if (segInfo) {
            const travelTimeMins = segInfo.travelTime / 60;
            if (dueMins <= 0.5) {
              // Tram is due at the station
              fromStopAbv = toStopAbv;
              progress = 0;
            } else if (dueMins < travelTimeMins) {
              // Interpolated position along segment
              progress = (travelTimeMins - dueMins) / travelTimeMins;
              progress = Math.max(0.05, Math.min(0.95, progress));
            } else {
              // Tram is further back, place near the starting stop of segment
              progress = 0.05;
            }
          }
        } else {
          // It's at the terminus or just starting
          fromStopAbv = toStopAbv;
          progress = 0;
        }

        // Calculate GPS coordinates
        const fromStop = stopsMap[fromStopAbv || toStopAbv];
        const toStop = stopsMap[toStopAbv];
        let lat = toStop.lat;
        let lng = toStop.lng;

        if (fromStop && fromStopAbv !== toStopAbv) {
          lat = fromStop.lat + progress * (toStop.lat - fromStop.lat);
          lng = fromStop.lng + progress * (toStop.lng - fromStop.lng);
        }

        compiledTrams.push({
          id: `live_${isRedLine?'red':'green'}_${direction.toLowerCase()}_${toStopAbv}_${Math.round(dueMins)}`,
          line: lineName,
          direction: direction,
          destination: fc.destination,
          nextStop: toStop.name,
          nextStopAbv: toStopAbv,
          dueMins: dueMins <= 0.5 ? 'DUE' : Math.round(dueMins),
          coords: [lat, lng],
          progress: progress,
          segment: fromStopAbv ? { from: fromStop.name, to: toStop.name } : null
        });
      });
    });
  }

  return compiledTrams;
}

// -------------------------------------------------------------
// TIMETABLE SIMULATION ENGINE
// -------------------------------------------------------------

// Active simulated trams state
let SIMULATED_TRAMS = [];
let simTramIdCounter = 0;

// Initialize simulated trams spaced along the routes
function initSimulation() {
  SIMULATED_TRAMS = [];
  
  // Spawning logic: We will pre-populate the lines with trams at different positions
  const simRoutes = [
    { key: 'red_outbound_tallaght', line: 'Luas Red Line', dir: 'Outbound', dest: 'Tallaght' },
    { key: 'red_outbound_saggart', line: 'Luas Red Line', dir: 'Outbound', dest: 'Saggart' },
    { key: 'red_inbound_thepoint_tal', line: 'Luas Red Line', dir: 'Inbound', dest: 'The Point' },
    { key: 'red_inbound_thepoint_sag', line: 'Luas Red Line', dir: 'Inbound', dest: 'The Point' },
    
    { key: 'green_outbound_bridesglen', line: 'Luas Green Line', dir: 'Outbound', dest: 'Brides Glen' },
    { key: 'green_inbound_broombridge', line: 'Luas Green Line', dir: 'Inbound', dest: 'Broombridge' }
  ];

  simRoutes.forEach(route => {
    const path = ROUTES[route.key];
    // Place 2-3 trams spaced out along each path
    const numTrams = 3;
    for (let i = 0; i < numTrams; i++) {
      // Place at 15%, 50%, 80% along the path stops index
      const targetStopIndex = Math.floor((path.length - 2) * (i + 1) / (numTrams + 1));
      const segmentProgress = 0.3; // arbitrary mid-segment start
      
      const fromAbv = path[targetStopIndex];
      const toAbv = path[targetStopIndex + 1];
      const segKey = `${fromAbv}_${toAbv}`;
      const segInfo = SEGMENT_METADATA[segKey];
      if (!segInfo) continue;

      const fromStop = stopsMap[fromAbv];
      const toStop = stopsMap[toAbv];
      const lat = fromStop.lat + segmentProgress * (toStop.lat - fromStop.lat);
      const lng = fromStop.lng + segmentProgress * (toStop.lng - fromStop.lng);

      SIMULATED_TRAMS.push({
        id: `sim_${++simTramIdCounter}`,
        line: route.line,
        direction: route.dir,
        routeKey: route.key,
        path: path,
        segmentIndex: targetStopIndex,
        progress: segmentProgress,
        destination: route.dest,
        nextStopAbv: toAbv,
        coords: [lat, lng]
      });
    }
  });

  console.log(`Initialized simulation with ${SIMULATED_TRAMS.length} virtual trams.`);
}

// Update simulation state every second
function updateSimulation() {
  // 1. Move existing trams
  for (let i = SIMULATED_TRAMS.length - 1; i >= 0; i--) {
    const tram = SIMULATED_TRAMS[i];
    const fromAbv = tram.path[tram.segmentIndex];
    const toAbv = tram.path[tram.segmentIndex + 1];
    const segKey = `${fromAbv}_${toAbv}`;
    const segInfo = SEGMENT_METADATA[segKey];
    
    if (!segInfo) {
      // End of route reached, remove tram
      SIMULATED_TRAMS.splice(i, 1);
      continue;
    }

    // Progress increments by 1 / travelTime per second
    tram.progress += 1 / segInfo.travelTime;

    if (tram.progress >= 1.0) {
      // Move to next segment
      tram.segmentIndex++;
      tram.progress = 0;
      
      if (tram.segmentIndex >= tram.path.length - 1) {
        // Reached terminus, remove
        SIMULATED_TRAMS.splice(i, 1);
        continue;
      }
      
      // Update next stop abbrev
      tram.nextStopAbv = tram.path[tram.segmentIndex + 1];
    }

    // Interpolate coordinates
    const curFromAbv = tram.path[tram.segmentIndex];
    const curToAbv = tram.path[tram.segmentIndex + 1];
    const fromStop = stopsMap[curFromAbv];
    const toStop = stopsMap[curToAbv];

    if (fromStop && toStop) {
      tram.coords = [
        fromStop.lat + tram.progress * (toStop.lat - fromStop.lat),
        fromStop.lng + tram.progress * (toStop.lng - fromStop.lng)
      ];
    }
  }

  // 2. Spawn new virtual trams (schedule check)
  // We'll spawn at endpoints if the headway spacing is clear.
  // Headway spacing: spawn a new tram if the closest tram of the same route is at least 3 stops away.
  const simRoutes = [
    { key: 'red_outbound_tallaght', line: 'Luas Red Line', dir: 'Outbound', dest: 'Tallaght' },
    { key: 'red_outbound_saggart', line: 'Luas Red Line', dir: 'Outbound', dest: 'Saggart' },
    { key: 'red_inbound_thepoint_tal', line: 'Luas Red Line', dir: 'Inbound', dest: 'The Point' },
    { key: 'red_inbound_thepoint_sag', line: 'Luas Red Line', dir: 'Inbound', dest: 'The Point' },
    
    { key: 'green_outbound_bridesglen', line: 'Luas Green Line', dir: 'Outbound', dest: 'Brides Glen' },
    { key: 'green_inbound_broombridge', line: 'Luas Green Line', dir: 'Inbound', dest: 'Broombridge' }
  ];

  simRoutes.forEach(route => {
    // Check if there are any trams on the first 3 segments of this route
    const hasCloseTram = SIMULATED_TRAMS.some(t => t.routeKey === route.key && t.segmentIndex < 3);
    if (!hasCloseTram) {
      const path = ROUTES[route.key];
      const fromAbv = path[0];
      const toAbv = path[1];
      const fromStop = stopsMap[fromAbv];
      const toStop = stopsMap[toAbv];

      if (fromStop && toStop) {
        SIMULATED_TRAMS.push({
          id: `sim_${++simTramIdCounter}`,
          line: route.line,
          direction: route.dir,
          routeKey: route.key,
          path: path,
          segmentIndex: 0,
          progress: 0,
          destination: route.dest,
          nextStopAbv: toAbv,
          coords: [fromStop.lat, fromStop.lng]
        });
      }
    }
  });
}

// Generate departures board from simulated trams for a specific stop
function getSimulatedForecast(stopAbv) {
  const result = {
    stopName: stopsMap[stopAbv] ? stopsMap[stopAbv].name : stopAbv,
    stopAbv: stopAbv,
    message: "Simulation Mode Active - Timetable estimates shown.",
    trams: []
  };

  SIMULATED_TRAMS.forEach(tram => {
    const path = tram.path;
    const stopIdx = path.indexOf(stopAbv);
    
    // Check if stop is ahead of the tram on its current route
    if (stopIdx !== -1 && tram.segmentIndex < stopIdx) {
      // Calculate remaining travel time in seconds
      let remainingSeconds = 0;
      
      // Part 1: Current segment remaining progress
      const currentFrom = path[tram.segmentIndex];
      const currentTo = path[tram.segmentIndex + 1];
      const curSegKey = `${currentFrom}_${currentTo}`;
      const curSeg = SEGMENT_METADATA[curSegKey];
      if (curSeg) {
        remainingSeconds += (1 - tram.progress) * curSeg.travelTime;
      }

      // Part 2: Travel time for downstream segments
      for (let i = tram.segmentIndex + 1; i < stopIdx; i++) {
        const segKey = `${path[i]}_${path[i+1]}`;
        const seg = SEGMENT_METADATA[segKey];
        if (seg) {
          remainingSeconds += seg.travelTime;
        }
      }

      const dueMins = remainingSeconds / 60;
      result.trams.push({
        direction: tram.direction,
        destination: tram.destination,
        dueMins: dueMins <= 0.5 ? 0.5 : Math.round(dueMins)
      });
    }
  });

  // Sort departures by time
  result.trams.sort((a, b) => a.dueMins - b.dueMins);

  // Group by direction and limit to top 3 departures per direction
  const inbound = result.trams.filter(t => t.direction === 'Inbound').slice(0, 3);
  const outbound = result.trams.filter(t => t.direction === 'Outbound').slice(0, 3);
  result.trams = [...inbound, ...outbound];

  return result;
}

// Compile all simulated trams to match the live format structure
function getSimulatedTramsList() {
  return SIMULATED_TRAMS.map(tram => {
    const fromAbv = tram.path[tram.segmentIndex];
    const toAbv = tram.path[tram.segmentIndex + 1];
    const segKey = `${fromAbv}_${toAbv}`;
    const segInfo = SEGMENT_METADATA[segKey];
    
    let dueMins = 1;
    if (segInfo) {
      dueMins = Math.round(((1 - tram.progress) * segInfo.travelTime) / 60);
    }

    return {
      id: tram.id,
      line: tram.line,
      direction: tram.direction,
      destination: tram.destination,
      nextStop: stopsMap[toAbv] ? stopsMap[toAbv].name : toAbv,
      nextStopAbv: toAbv,
      dueMins: dueMins <= 0 ? 'DUE' : dueMins,
      coords: tram.coords,
      progress: tram.progress,
      segment: {
        from: stopsMap[fromAbv] ? stopsMap[fromAbv].name : fromAbv,
        to: stopsMap[toAbv] ? stopsMap[toAbv].name : toAbv
      }
    };
  });
}

// -------------------------------------------------------------
// BACKGROUND POLL & UPDATE TASK
// -------------------------------------------------------------

async function systemUpdateCycle() {
  if (CONFIG.mode === 'simulation') {
    SYSTEM_STATUS.currentMode = 'simulation';
    SYSTEM_STATUS.apiConnected = false;
    // Simulator tick is handled in a separate 1s timer, this is just for high-level sync
    return;
  }

  try {
    const liveData = await fetchAllForecasts();
    const stopsWithData = Object.keys(liveData);
    
    if (stopsWithData.length === 0) {
      throw new Error("No live stop forecast data retrieved.");
    }

    // Check if live data actually contains any valid active trams
    const totalTramsCount = Object.values(liveData).reduce((sum, stop) => sum + stop.trams.length, 0);

    if (totalTramsCount === 0) {
      // Live API is connected, but there are no actual trams (i.e. service shutdown)
      console.warn("Live API retrieved successfully, but 0 active trams were reported. Falling back to Simulation Mode.");
      SYSTEM_STATUS.apiConnected = true;
      if (Object.keys(AVLS_VEHICLE_MAP).length > 0) {
        SYSTEM_STATUS.currentMode = 'live';
        LIVE_TRAMS = getCurrentAVLSMapTrams();
      } else if (CONFIG.mode === 'auto') {
          SYSTEM_STATUS.currentMode = 'simulation';
      } else {
        SYSTEM_STATUS.currentMode = 'live';
        LIVE_TRAMS = [];
      }
    } else {
      // Live API has active data!
      console.log(`Live API active. Parsed ${totalTramsCount} arrival predictions across the network.`);
      SYSTEM_STATUS.apiConnected = true;
      SYSTEM_STATUS.currentMode = 'live';
      
      // Run tracking algorithm
      LIVE_TRAMS = processLiveTrams(liveData);
      
      // Save forecasts for easy stop lookup
      LIVE_DEPARTURES = {};
      stopsWithData.forEach(abv => {
        LIVE_DEPARTURES[abv] = liveData[abv];
      });
      console.log(`State Estimation: Tracked ${LIVE_TRAMS.length} active physical trams on the network.`);
    }
  } catch (error) {
    console.error("Error fetching live Luas data:", error.message);
    SYSTEM_STATUS.apiConnected = false;
    SYSTEM_STATUS.activeAlerts = [`Live API disconnected: ${error.message}`];
    
    if (CONFIG.mode === 'auto') {
      SYSTEM_STATUS.currentMode = Object.keys(AVLS_VEHICLE_MAP).length > 0 ? 'live' : 'simulation';
    } else {
      SYSTEM_STATUS.currentMode = 'live';
      LIVE_TRAMS = [];
    }
  }
}

// -------------------------------------------------------------
// AVLS VEHICLE POLL
// -------------------------------------------------------------

async function pollAVLSVehicles() {
  try {
    console.log('Polling AVLS vehicle positions...');
    const entries = await fetchAllAVLSData();
    AVLS_VEHICLE_MAP = compileVehiclePositions(entries);
    AVLS_LAST_POLL = new Date().toISOString();
    const seenAt = new Date();

    Object.values(AVLS_VEHICLE_MAP).forEach(vehicle => {
      const enriched = enrichVehicleForFinder({
        ...vehicle,
        lastSeenAt: AVLS_LAST_POLL,
        lastSeenDisplay: formatLocalTime(seenAt)
      }, true);

      VEHICLE_HISTORY[vehicle.tramNumber] = {
        ...enriched,
        isCurrent: false
      };
    });

    saveVehicleHistory();
    if (Object.keys(AVLS_VEHICLE_MAP).length > 0 && CONFIG.mode !== 'simulation') {
      SYSTEM_STATUS.currentMode = 'live';
      SYSTEM_STATUS.apiConnected = true;
    }
    console.log(`AVLS: Tracked ${Object.keys(AVLS_VEHICLE_MAP).length} real trams (${entries.length} predictions).`);
  } catch (err) {
    console.error('AVLS poll error:', err.message);
  }
}

// -------------------------------------------------------------
// API EXPRESS ROUTER
// -------------------------------------------------------------

// Get all stops (grouped by line)
app.get('/api/stops', (req, res) => {
  res.json(stopsData);
});

// Get system status (mode, API connection, alerts)
app.get('/api/status', (req, res) => {
  res.json(SYSTEM_STATUS);
});

// Post config mode overrides ('auto', 'live', 'simulation')
app.get('/api/mode/:mode', (req, res) => {
  const targetMode = req.params.mode.toLowerCase();
  if (['auto', 'live', 'simulation'].includes(targetMode)) {
    CONFIG.mode = targetMode;
    console.log(`System mode overridden to: ${targetMode}`);
    if (targetMode === 'simulation') {
      SYSTEM_STATUS.currentMode = 'simulation';
    }
    // Run an immediate update cycle to adapt
    systemUpdateCycle();
    res.json({ success: true, mode: targetMode, current: SYSTEM_STATUS.currentMode });
  } else {
    res.status(400).json({ error: 'Invalid mode. Use: auto, live, or simulation.' });
  }
});

// Get all currently tracked/simulated trams
app.get('/api/trams', (req, res) => {
  if (CONFIG.mode === 'simulation') {
    res.json({ trams: getSimulatedTramsList() });
  } else {
    const avlsTrams = getCurrentAVLSMapTrams();
    if (avlsTrams.length > 0) {
      res.json({ trams: avlsTrams });
    } else if (SYSTEM_STATUS.currentMode === 'simulation') {
      res.json({ trams: getSimulatedTramsList() });
    } else {
      res.json({ trams: LIVE_TRAMS });
    }
  }
});

// Get real vehicle positions from AVLS scraper
// Returns list of physical trams with their vehicle numbers and current locations
app.get('/api/vehicles', (req, res) => {
  const vehicles = Object.values(AVLS_VEHICLE_MAP).map(vehicle => {
    const history = VEHICLE_HISTORY[vehicle.tramNumber] || {};
    return enrichVehicleForFinder({
      ...vehicle,
      lastSeenAt: history.lastSeenAt || AVLS_LAST_POLL,
      lastSeenDisplay: history.lastSeenDisplay || null
    }, true);
  });
  vehicles.sort((a, b) => a.tramNumber.localeCompare(b.tramNumber));
  res.json({
    lastUpdated: AVLS_LAST_POLL,
    count: vehicles.length,
    vehicles
  });
});

// Get current and last-seen vehicle records for Tram Finder
app.get('/api/vehicle-history', (req, res) => {
  const currentVehicleIds = new Set(Object.keys(AVLS_VEHICLE_MAP));
  const records = [];

  Object.values(AVLS_VEHICLE_MAP).forEach(vehicle => {
    const history = VEHICLE_HISTORY[vehicle.tramNumber] || {};
    records.push(enrichVehicleForFinder({
      ...vehicle,
      lastSeenAt: history.lastSeenAt || AVLS_LAST_POLL,
      lastSeenDisplay: history.lastSeenDisplay || null
    }, true));
  });

  Object.values(VEHICLE_HISTORY).forEach(vehicle => {
    if (!currentVehicleIds.has(vehicle.tramNumber)) {
      records.push(enrichVehicleForFinder(vehicle, false));
    }
  });

  records.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.tramNumber.localeCompare(b.tramNumber);
  });

  res.json({
    lastUpdated: AVLS_LAST_POLL,
    currentCount: currentVehicleIds.size,
    count: records.length,
    vehicles: records
  });
});

// Get a single vehicle's position by tram number
app.get('/api/vehicles/:tramNumber', (req, res) => {
  const tram = AVLS_VEHICLE_MAP[req.params.tramNumber] || VEHICLE_HISTORY[req.params.tramNumber];
  if (!tram) {
    return res.status(404).json({ error: `Tram ${req.params.tramNumber} has not been tracked yet.` });
  }
  res.json(enrichVehicleForFinder(tram, Boolean(AVLS_VEHICLE_MAP[req.params.tramNumber])));
});

// Get live departures board for a specific stop
app.get('/api/forecast/:stop', (req, res) => {
  const stopAbbrev = req.params.stop.toUpperCase();
  if (!stopsMap[stopAbbrev]) {
    return res.status(404).json({ error: 'Stop not found.' });
  }

  if (SYSTEM_STATUS.currentMode === 'simulation') {
    res.json(getSimulatedForecast(stopAbbrev));
  } else {
    const departures = LIVE_DEPARTURES[stopAbbrev];
    if (departures && departures.trams && departures.trams.length > 0) {
      res.json(departures);
    } else {
      res.json(getAVLSForecastForStop(stopAbbrev));
    }
  }
});

// Start timers
initSimulation();
setInterval(updateSimulation, 1000); // simulation runs every 1s
setInterval(systemUpdateCycle, CONFIG.pollIntervalMs); // poll live data every 20s
setInterval(pollAVLSVehicles, AVLS_POLL_INTERVAL_MS); // poll AVLS vehicle numbers every 30s
systemUpdateCycle(); // trigger initial poll on startup
pollAVLSVehicles();  // initial AVLS vehicle poll

app.listen(PORT, () => {
  console.log(`Luas Tram Tracker Server listening on port ${PORT}`);
});
