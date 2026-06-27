const http = require('http');
const https = require('https');

const stops = ['ABB', 'DUN', 'RED', 'RAN'];

function fetchForecast(stop) {
  const url = `https://luasforecasts.rpa.ie/xml/get.ashx?action=forecast&stop=${stop}&encrypt=false`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`--- Stop: ${stop} ---`);
      console.log(data);
    });
  }).on('error', (err) => {
    console.error(`Error fetching forecast for ${stop}:`, err);
  });
}

stops.forEach(fetchForecast);
