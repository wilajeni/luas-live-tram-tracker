# Luas Live Tram Tracker (v1.0)

An interactive, real-time Dublin Luas tram tracker web application. It displays live tram positions, tracks segments, handles line notifications, and features a clean glassmorphic UI dashboard with search capability, stop departures timetables, and active tram finders.

## Features

- 🗺️ **Real-time Map tracking**: Active Leaflet map showing Red and Green line routes, stop locations, and current tram positions.
- 📐 **AVLS Tracking and Coordinates Interpolation**: Real-time AVLS (Automatic Vehicle Location System) polling that calculates tram positions and tracks travel direction on each segment using geographical bearings.
- 🚈 **Directional Arrows**: Trams point dynamically in their exact direction of travel (using spherical bearing calculations).
- 🕒 **Departures Timetable Card**: Displays upcoming inbound/outbound departures in a highly compact view, featuring an internal scrollbar when listing multiple upcoming trams.
- 🔔 **Calm/Alert Notification Banners**: Banners placed at the top-right of the map display line conditions. Normal operation stays calm and subtle, while active alerts trigger eye-catching warnings.
- 💡 **Selected Stop Highlights**: Clicking stop markers displays them as prominent hollow rings in their line's colour with outer glows.
- 🔄 **Timetable Simulation fallback**: Automatically detects if the live API is disconnected or has zero active trams, falling back to a realistic simulated timetable to ensure full application availability.
- 🛠️ **System Diagnostics**: Development/testing panel containing API connectivity checks and manual mode forcing, visible on local environments only.

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

### Running the App

To start the server, run:
   ```bash
   node server.js
   ```
The app will output:
   `Luas Tram Tracker Server listening on port 3000`

Open your browser and navigate to:
   [http://localhost:3000/](http://localhost:3000/)

---

## Code Architecture

- **`server.js`**: The Express server hosting API proxies (`/api/forecast/:abbrev`, `/api/trams`, `/api/status`, `/api/stops`) and executing the main background loop.
- **`avls_module.js`**: Module polling the National Transport Authority AVLS feed, tracking vehicle history, and mapping XML data to active tram objects.
- **`public/index.html`**: Structured HTML5 skeleton of the responsive layout container.
- **`public/app.js`**: Client-side controller handling leaflet rendering, UI updates, search filtering, and state synchronization.
- **`public/style.css`**: Complete premium dark-glassmorphism stylesheet with responsive breakpoints and custom scrollbars.
- **`stops.json`**: Static database compiling names, abbreviations, coordinates, and facilities (cycle parking, park & ride) for all Red and Green line stops.

---

## Position and Heading Estimation

The backend dynamically estimates the position of trams between stations when live GPS feeds are unavailable. It does this by:
1. Finding the tram's route path and current segment (between two stops).
2. Calculating the progress along the segment:
   $$\text{Progress} = \frac{\text{TravelTime} - \text{DueMins}}{\text{TravelTime}}$$
3. Calculating coordinates by linear interpolation of latitude and longitude.
4. On the client side, the heading (bearing) is computed using the spherical model:
   $$y = \sin(\Delta\lambda) \cdot \cos(\phi_2)$$
   $$x = \cos(\phi_1) \cdot \sin(\phi_2) - \sin(\phi_1) \cdot \cos(\phi_2) \cdot \cos(\Delta\lambda)$$
   $$\text{Bearing} = \operatorname{atan2}(y, x)$$
   The tram icon is then rotated dynamically to point towards the next stop.

---

## Version History

- **v1.0** (Current)
  - Simplified departures timetable card to render rows compactly in a single line.
  - Added internal scrollbar inside `#station-departures-card` timetable list.
  - Implemented spherical bearing formulas for tram arrows.
  - Split alert system into two floating top-right banners with normal/warning icons.
  - Refactored selected stop highlight map icons to use prominent white-filled outer glow rings.
  - Git repository initialized, staged, and tagged.
