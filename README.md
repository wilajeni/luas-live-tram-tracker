# Luas Live Tram Tracker

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)

An interactive, real-time Dublin Luas tram tracker web application. It displays live tram positions, track segments, handles line notifications, and features a clean glassmorphic UI dashboard with search capability, stop departures timetables, and active tram finders.

**Disclaimer**: This project is an independent, unofficial application. It is not affiliated with, endorsed by, or connected to Transport Infrastructure Ireland (TII), Transdev, or the official Luas service. Data is sourced from public API endpoints for educational and personal use.

## Features

- 🗺️ **Real-time Map tracking**: Active Leaflet map showing Red and Green line routes, stop locations, and current tram positions.
- 📱 **Mobile & PWA Ready**: Fully responsive design with an interactive bottom sheet for mobile users. Can be installed as a Progressive Web App (PWA) on iOS/Android home screens for a full-screen, app-like experience.
- ⭐ **Local Favorites**: Save your most-used stations directly to your device via `localStorage`—no account or login required.
- 📐 **AVLS Tracking and Coordinates Interpolation**: Real-time AVLS (Automatic Vehicle Location System) polling that calculates tram positions and tracks travel direction on each segment using geographical bearings.
- 🚈 **Directional Arrows**: Trams point dynamically in their exact direction of travel (using spherical bearing calculations).
- 🕒 **Departures Timetable Card**: Displays upcoming inbound/outbound departures in a highly compact view, including ETA calculations.
- 🔔 **Alert Notification Banners**: Banners placed at the top-right of the map display line conditions. Normal operation stays calm and subtle, while active alerts trigger eye-catching warnings.
- 🛡️ **Smart Polling & Security**: Backend utilizes smart lazy polling to pause API requests when no users are active, conserving resources. Secured with `helmet` and `express-rate-limit`.
- 🔄 **Timetable Simulation fallback**: Automatically detects if the live API is disconnected or has zero active trams, falling back to a realistic simulated timetable to ensure full application availability.
- 🌗 **Dark/Light Modes**: Full Light Theme support toggled via a floating Sun/Moon button, switching between CartoDB Dark Matter and Positron tiles dynamically.

---

## Getting Started

### Prerequisites

You need [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone or download this repository.
2. Open a terminal in the root folder of the project.
3. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

To start the server, run:
```bash
node server.js
```

The app will output:
`Luas Tram Tracker Server listening on port 3000`

Open your browser and navigate to:
[http://localhost:3000/](http://localhost:3000/)

### Deployment (Render.com)

This application is optimized for free-tier hosting on Render:
1. Connect your GitHub repository to Render and create a **Web Service**.
2. Build Command: `npm install`
3. Start Command: `node server.js`
4. **Keep-Alive**: To prevent the free tier from spinning down, the app exposes a `/api/ping` endpoint. You can use a free service like [cron-job.org](https://cron-job.org/) to ping this URL every 9 minutes.

---

## Code Architecture

- **`server.js`**: The Express server hosting API proxies and executing the main background loop.
- **`avls_module.js`**: Module polling the AVLS feed, tracking vehicle history, and mapping XML data to active tram objects.
- **`public/`**: Contains the frontend assets:
  - **`index.html`**: Structured HTML5 skeleton of the responsive layout container.
  - **`app.js`**: Client-side controller handling Leaflet rendering, UI updates, search filtering, and state synchronization.
  - **`style.css`**: Complete premium glassmorphism stylesheet with responsive breakpoints.
- **`stops.json`**: Static database compiling names, abbreviations, coordinates, and facilities for all Red and Green line stops.

---

## Position and Heading Estimation

The backend dynamically estimates the position of trams between stations when live GPS feeds are unavailable. It does this by:
1. Finding the tram's route path and current segment (between two stops).
2. Calculating the progress along the segment based on `TravelTime` and `DueMins`.
3. Calculating coordinates by linear interpolation of latitude and longitude.
4. On the client side, the heading (bearing) is computed using the spherical model. The tram icon is then rotated dynamically to point towards the next stop.

---

## License

This project is open-source and available under the [MIT License](LICENSE).
