const https = require('https');
const fs = require('fs');

const stopsData = JSON.parse(fs.readFileSync('stops.json'));
const allStops = [];

for (const line in stopsData) {
  stopsData[line].forEach(stop => {
    allStops.push(stop);
  });
}

console.log(`Found ${allStops.length} stops. Scanning live forecasts...`);

let completed = 0;
const results = [];

function checkStop(stop) {
  const url = `https://luasforecasts.rpa.ie/xml/get.ashx?action=forecast&stop=${stop.abbrev}&encrypt=false`;
  
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      // Parse trams using simple regex
      // <tram destination="Destination" dueMins="Mins" />
      const tramRegex = /<tram destination="([^"]+)" dueMins="([^"]*)"/g;
      let match;
      const trams = [];
      while ((match = tramRegex.exec(data)) !== null) {
        trams.push({
          destination: match[1],
          dueMins: match[2]
        });
      }

      // Check if there's any message
      const msgMatch = data.match(/<message>([^<]*)<\/message>/);
      const message = msgMatch ? msgMatch[1] : '';

      results.push({
        stop: stop.name,
        abbrev: stop.abbrev,
        message: message,
        trams: trams
      });

      completed++;
      if (completed === allStops.length) {
        finish();
      }
    });
  }).on('error', (err) => {
    console.error(`Error checking ${stop.abbrev}:`, err);
    completed++;
    if (completed === allStops.length) {
      finish();
    }
  });
}

function finish() {
  console.log('\n--- SCAN COMPLETED ---');
  let activeCount = 0;
  
  results.forEach(res => {
    const validTrams = res.trams.filter(t => t.dueMins && t.dueMins !== '' && t.destination !== 'See news for information');
    if (validTrams.length > 0) {
      activeCount++;
      console.log(`Stop: ${res.stop} (${res.abbrev})`);
      if (res.message) console.log(`  Message: ${res.message}`);
      console.log(`  Trams:`, validTrams);
    }
  });

  console.log(`\nFound ${activeCount} stops with active trams out of ${results.length} stops.`);
  
  // Also print general info about messages if any
  const uniqueMessages = [...new Set(results.map(r => r.message).filter(Boolean))];
  console.log('\nDisruption Messages found across the network:');
  uniqueMessages.forEach(m => console.log(`- ${m}`));
}

allStops.forEach(stop => {
  // Let's delay slightly to not flood
  setTimeout(() => checkStop(stop), 50 * allStops.indexOf(stop));
});
