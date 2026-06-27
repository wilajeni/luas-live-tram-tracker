/**
 * AVLS Vehicle Tracking Module
 * 
 * Fetches real tram vehicle numbers and positions by scraping
 * luasforecasts.rpa.ie/analysis/view.aspx?id=<stopId>
 * 
 * The page returns an AVLS (Automatic Vehicle Location System) table with:
 *   Direction | Destination | Time | AVLS Time | Tram | Action | ...
 * 
 * Key URL format: GET /analysis/view.aspx?id=<numericStopId>
 * This is distinct from ?stop=<abbrev> (form) and ?stop=<id> (empty form)
 */

const https = require('https');

// Numeric stop ID → stop abbreviation
const STOP_ID_MAP = {
  // Red Line
  1: 'TAL',  2: 'HOS',  3: 'COO',  4: 'BEL',  5: 'KIN',
  6: 'RED',  7: 'KYL',  8: 'BLU',  9: 'BLA',  10: 'DRI',
  11: 'GOL', 12: 'SUI', 13: 'RIA', 14: 'FAT', 15: 'JAM',
  16: 'HEU', 17: 'MUS', 18: 'SMI', 19: 'FOU', 20: 'JER',
  21: 'ABB', 22: 'BUS', 23: 'CON', 49: 'FET', 50: 'CVN',
  51: 'CIT', 52: 'FOR', 53: 'SAG', 54: 'GDK', 55: 'MYS',
  56: 'SDK', 57: 'TPT', 73: 'HIN', 74: 'HCT',
  // Green Line
  24: 'STS', 25: 'HAR', 26: 'CHA', 27: 'RAN', 28: 'BEE',
  29: 'COW', 30: 'MIL', 31: 'WIN', 32: 'DUN', 33: 'BAL',
  34: 'KIL', 35: 'STI', 36: 'SAN', 37: 'CPK', 38: 'GLE',
  39: 'GAL', 40: 'LEO', 42: 'BAW', 44: 'CCK', 45: 'BRE',
  46: 'LAU', 47: 'CHE', 48: 'BRI', 59: 'DAW', 60: 'TRY',
  61: 'WES', 62: 'MAR', 63: 'OGP', 64: 'OUP', 65: 'PAR',
  66: 'DOM', 67: 'BRD', 68: 'GRA', 69: 'PHI', 70: 'CAB',
  71: 'BRO', 72: 'STX'
};

const ALL_STOP_IDS = Object.keys(STOP_ID_MAP).map(Number);

// Determine which line a stop is on
function getLineForStop(abbrev) {
  const RED_STOPS = new Set([
    'TAL','HOS','COO','BEL','KIN','RED','KYL','BLU','BLA','DRI',
    'GOL','SUI','RIA','FAT','JAM','HEU','MUS','SMI','FOU','JER',
    'ABB','BUS','CON','FET','CVN','CIT','FOR','SAG','GDK','MYS',
    'SDK','TPT','HIN','HCT'
  ]);
  return RED_STOPS.has(abbrev) ? 'Luas Red Line' : 'Luas Green Line';
}

function fetchStopPage(stopId) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'luasforecasts.rpa.ie',
      path: `/analysis/view.aspx?id=${stopId}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ stopId, body: data, ok: true }));
    });
    req.on('error', () => resolve({ stopId, body: '', ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ stopId, body: '', ok: false }); });
    req.end();
  });
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  return null;
}

function parseStopPage(stopId, html) {
  const abbrev = STOP_ID_MAP[stopId];
  if (!abbrev) return [];
  
  const entries = [];
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowCount = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    rowCount++;
    if (rowCount === 1) continue; // Skip header

    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const text = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(text);
    }

    // Columns: Direction(0), Destination(1), Time(2), AVLS Time(3), Tram(4), Action(5)
    if (cells.length >= 5 && /^\d{4}$/.test(cells[4])) {
      const dueMins = parseTimeToMinutes(cells[3]) ?? parseTimeToMinutes(cells[2]);
      entries.push({
        stopAbbrev: abbrev,
        stopId: Number(stopId),
        line: getLineForStop(abbrev),
        direction: cells[0],
        destination: cells[1],
        dueMins,
        tramNumber: cells[4],
        action: cells[5] || ''
      });
    }
  }

  return entries;
}

/**
 * Fetch all stops' AVLS data in batches
 * Returns array of raw prediction entries
 */
async function fetchAllAVLSData() {
  const allEntries = [];
  const BATCH_SIZE = 12;
  const BATCH_DELAY = 150; // ms between batches

  for (let i = 0; i < ALL_STOP_IDS.length; i += BATCH_SIZE) {
    const batch = ALL_STOP_IDS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(id => fetchStopPage(id)));

    results.forEach(res => {
      if (res.ok && res.body) {
        const entries = parseStopPage(res.stopId, res.body);
        allEntries.push(...entries);
      }
    });

    if (i + BATCH_SIZE < ALL_STOP_IDS.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return allEntries;
}

/**
 * Compile raw entries into a vehicle position map
 * Returns: { tramNumber -> { tramNumber, line, direction, destination, nextStop, nextStopId, dueMins, sightings[] } }
 */
function compileVehiclePositions(entries) {
  const vehicleMap = {};

  entries.forEach(e => {
    if (!vehicleMap[e.tramNumber]) {
      vehicleMap[e.tramNumber] = {
        tramNumber: e.tramNumber,
        line: e.line,
        direction: e.direction,
        destination: e.destination,
        sightings: []
      };
    }
    vehicleMap[e.tramNumber].sightings.push({
      stopAbbrev: e.stopAbbrev,
      stopId: e.stopId,
      direction: e.direction,
      destination: e.destination,
      dueMins: e.dueMins
    });
  });

  // For each vehicle, find the nearest upcoming stop (min dueMins)
  Object.values(vehicleMap).forEach(v => {
    v.sightings.sort((a, b) => {
      if (a.dueMins === null) return 1;
      if (b.dueMins === null) return -1;
      return a.dueMins - b.dueMins;
    });

    const nearest = v.sightings[0];
    v.nextStop = nearest.stopAbbrev;
    v.nextStopId = nearest.stopId;
    v.dueMins = nearest.dueMins;
    // Use the direction/destination of the nearest sighting
    v.direction = nearest.direction;
    v.destination = nearest.destination;
  });

  return vehicleMap;
}

module.exports = {
  STOP_ID_MAP,
  ALL_STOP_IDS,
  fetchAllAVLSData,
  compileVehiclePositions,
  getLineForStop
};
