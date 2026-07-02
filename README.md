# Metro Live Istanbul

A modern, official-grade web app that shows **where every Istanbul metro & Marmaray train
should be right now** — as realistically as possible — the instant you open it.

There is **no official live train-position feed** for Istanbul rail (verified across three
independent research passes — see [`docs/research/RESEARCH-REPORT.md`](docs/research/RESEARCH-REPORT.md)).
So positions come from a **high-accuracy, schedule-based simulation engine**: timetables,
service frequencies, inter-station run times, dwell/turnaround times, time-of-day bands and
night-metro rules. The app is transparent about this — the "How this works" dialog explains
that positions are estimated, not GPS.

**Live arrivals.** The station **"Yaklaşan Seferler"** (approaching trains) screen shows **real,
minute-accurate next departures** from metro.istanbul's own service-status endpoint, via an
integrated backend ([`server/`](server/README.md)). Covered lines (M1A–M9, T1–T5, F1/F4, TF1/TF2)
use live data; anything not covered (Marmaray, Metrobüs, …) or any moment the backend is
unreachable falls back to the simulation, so the screen never breaks.

## Features

- **Live map (hero):** every line in official colors with trains animating between stations,
  driven by the simulation; ~150–180 active trains at midday, only night-metro lines after 00:00.
- **19 lines** incl. **Marmaray** crossing the Bosphorus; **261 stations** with transfers,
  accessibility (elevator/escalator), and facilities (WC, prayer room, baby room).
- **Line detail:** live train count, current frequency, service hours, length, full station list.
- **Station detail:** serving lines, **approaching trains** (real metro.istanbul minutes where
  covered, simulation elsewhere), accessibility & facilities.
- **Search** (stations + lines), **favorites**, **recent**, **nearest station** (geolocation).
- **Light/Dark/System** theme, **Turkish + English**, responsive (floating panel ↔ bottom sheet),
  installable **PWA** with offline basemap caching.

## Tech stack

**Frontend:** React 19 · TypeScript · Vite 8 · MapLibre GL · Zustand · i18next · vite-plugin-pwa.
**Backend (`server/`):** Node · TypeScript (ESM, run with `tsx`) · Express — a proxy/BFF over
metro.istanbul's `SeferDurumlari` service. One project, one `package.json`.
Data: Metro İstanbul Mobile API + İBB Open Data (GeoJSON) + CARTO/OpenStreetMap basemaps.

## Develop

```bash
cp .env.example .env   # optional — sane defaults otherwise
npm install
npm run dev        # frontend (http://localhost:5173) + backend (:3001) together
npm run build      # type-check + production build (frontend, for GitHub Pages)
npm run preview    # serve the build
npm run lint
npm run typecheck  # frontend + server
```

Backend-only helpers: `npm run start:api`, `npm run seed:refresh`, `npm run test:server`.
In dev, Vite proxies `/api` → the backend (no CORS). See [`server/README.md`](server/README.md)
for the reverse-engineering details and **deployment** (frontend → GitHub Pages, backend →
any Node host; wire them with `VITE_API_BASE_URL`).

## Data pipeline

The static dataset (`src/data/network.generated.json`) is built from official sources:

```bash
node scripts/data/fetch.mjs   # download raw sources → data/raw/
node scripts/data/build.mjs   # → src/data/network.generated.json
```

## Project structure

```
src/
  data/            # generated dataset + typed loader
  features/
    map/           # MapLibre map, layers, animation loop
    panel/         # home / line / station views (responsive panel)
    lines/ info/   # line badge, "how it works" dialog
  lib/
    api/           # typed client for the live-arrivals backend
    arrivals/      # useStationArrivals — hybrid live + simulation hook
    simulation/    # schedule-based position engine
    network/       # domain types
    stores/        # zustand (ui, sim, app)
    geo, stats, format, theme
  i18n/            # TR + EN
server/            # live-arrivals backend (Express + tsx); see server/README.md
scripts/data/      # fetch + build the dataset
scripts/dev/       # screenshot + icon tooling
docs/research/     # the research report this was built on
docs/realtime-integration/  # vision / API analysis / architecture notes
```

## Roadmap

M11 + under-construction lines (data-model already supports them), service announcements
(`GetAnnouncements`), A→B trip planning, crowding estimate, richer track geometry via OSM.
