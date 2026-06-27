const http = require('http');
const https = require('https');
const fs = require('fs');

const url = 'http://luasforecasts.rpa.ie/xml/get.ashx?action=stops&encrypt=false';


function fetchUrl(targetUrl) {
  console.log('Fetching:', targetUrl);
  const client = targetUrl.startsWith('https') ? https : http;
  client.get(targetUrl, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log('Redirecting to:', res.headers.location);
      fetchUrl(res.headers.location);
      return;
    }

    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('Received XML data. Length:', data.length);
      if (data.length === 0) {
        console.log('Empty response body.');
        return;
      }
      
      // Parse stop tags
      const stopRegex = /<stop abrev="([^"]+)" isParkRide="([^"]+)" isCycleRide="([^"]+)" lat="([^"]+)" long="([^"]+)" pronunciation="([^"]+)">([^<]+)<\/stop>/g;
      
      const lines = data.split('</line>');
      const parsedData = {};

      lines.forEach(lineStr => {
        const lineNameMatch = lineStr.match(/<line name="([^"]+)">/);
        if (!lineNameMatch) return;
        const lineName = lineNameMatch[1];
        parsedData[lineName] = [];

        let match;
        stopRegex.lastIndex = 0;
        while ((match = stopRegex.exec(lineStr)) !== null) {
          parsedData[lineName].push({
            abbrev: match[1],
            isParkRide: match[2] === '1',
            isCycleRide: match[3] === '1',
            lat: parseFloat(match[4]),
            lng: parseFloat(match[5]),
            pronunciation: match[6],
            name: match[7]
          });
        }
      });

      fs.writeFileSync('stops.json', JSON.stringify(parsedData, null, 2));
      console.log('Saved stops.json successfully!');
    });
  }).on('error', (err) => {
    console.error('Error fetching stops:', err);
  });
}

fetchUrl(url);
