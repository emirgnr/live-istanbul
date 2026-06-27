# Metro Live Istanbul

A modern, official-grade web app that shows **where every Istanbul metro & Marmaray train should be right now** — as realistically as possible — the instant you open it.

When no official live GPS/GTFS-Realtime feed is available, positions are produced by a
**high-accuracy, schedule-based simulation engine** (timetables, headways, inter-station run
times, dwell/turnaround times, time-of-day frequency, operating rules) so the experience feels
live even without real-time vehicle data.

## Status

🚧 Early scaffold. Comprehensive technical research (data sources, operations, product & design)
is being synthesized; the data pipeline, simulation engine, and full UI follow.

## Tech stack

- **React 19 + TypeScript + Vite** — fast, modern web app
- **MapLibre GL JS** — animated live train rendering on a vector basemap
- **vite-plugin-pwa** — installable, offline-capable PWA
- **Zustand** — lightweight state
- **i18next** — Turkish + English

## Scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server                 |
| `npm run build`   | Type-check and build for production   |
| `npm run preview` | Preview the production build          |
| `npm run lint`    | Lint                                  |
| `npm run format`  | Format with Prettier                 |

## Project structure

```
src/
  features/        # feature modules (map, lines, stations, …)
  styles/          # design tokens + global styles
  lib/             # simulation engine, data access, utilities (added next)
  data/            # generated static dataset (lines, stations, geometry)
```
