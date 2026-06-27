I'll synthesize this research into the final report. Note: the input data appears truncated at the end (feature catalog dimension cuts off), and several dimensions (design system, tech stack, verification/adversarial pass) are not present in the provided JSON. I'll write the comprehensive report from the substantial data that IS present, flag where streams are missing, and apply best-practice recommendations for the design/tech-stack sections that lack dedicated input, clearly marking those as synthesized rather than sourced.

# Metro Live Istanbul — Final Research Report

*Lead researcher synthesis for product + engineering. Date of synthesis: 2026-06-27.*

> **Scope note on inputs.** This report synthesizes the research streams that were delivered: static schedule data, geographic data, operational/simulation characteristics, the 2026 line/station inventory, official-app product analysis, and the prioritized feature catalog. Two of the requested streams — a standalone **design-system** stream and a standalone **tech-stack** stream — and an explicit **adversarial verification pass** were **not present in the supplied data** (the feature-catalog stream is also truncated mid-record). For sections 10 (Design) and 11 (Tech Stack) I synthesize opinionated recommendations grounded in the data that *is* present (brand colors, map-rendering pattern via Mini Tokyo 3D, MD3/HIG conventions) and label them as **engineering recommendation, not sourced research**. Where the input contained internal contradictions, I resolve them by preferring primary/official sources and the most-recently-verified figures, and I note the resolution inline.

---

## 1. Executive Summary

**Bottom line on a live train-position API:** **There is NO official, public, per-second GPS / GTFS-Realtime vehicle-position feed for Istanbul metro or Marmaray trains.** This was the most important and most heavily cross-checked finding across three independent streams. İBB/İETT *do* publish real-time **bus** positions (`GetVehicleLocations`, polled ~1×/min; the "Otobüsüm Nerede" app), and Metro İstanbul *does* publish a free, key-free **schedule/timetable** REST API plus a frozen static GTFS feed — but nothing that streams where trains actually are. No Istanbul rail GTFS-RT feed was found on Mobility Database or Transitland either.

**Consequence for the hero feature:** the "where is every train right now" map must be built as a **high-fidelity schedule/headway-driven simulation** — interpolating train positions along line geometry from timetables and known run-times, in the proven style of **Mini Tokyo 3D** (open source, MIT). This is achievable today and looks convincingly live, but it must be honestly framed as *estimated*, with confidence/“simulated” styling. It is **not** GPS truth.

**What you have to work with (all free, no key):**
- **Metro İstanbul Mobile API** (`api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/`) — lines (with colors, first/last times), full station lists with order + lat/lon, timetables, maps, fares, multilingual announcements. **This is the live source of truth.**
- **İBB static GTFS** (`data.ibb.gov.tr`) — complete structural feed (routes, stops, shapes, stop_times with per-segment run-times, frequencies) for metro + Marmaray + trams. **Frozen/expired** (calendar ends 2024-12-31; "will not be updated") — use for *structure and geometry*, refresh *times* from the live API.
- **İBB official GeoJSON** — 343 station points + 37 line geometries + station polygons, each tagged existing vs under-construction. **Best geographic source.**
- **OpenStreetMap / Overpass** — complete, well-tagged route relations (incl. under-construction lines) as an alternative/supplement.

**Network as of June 2026** (verified against the official network map *v.3 rev.20.0, Haziran 2026*): **11 metro lines (M1A, M1B, M2, M3, M4, M5, M6, M7, M8, M9, M11)**, 5 modern trams + nostalgic T2/T3, 4 funiculars + heritage Tünel, 2 cable cars, and **Marmaray** (43 stations, Halkalı–Gebze, operated by TCDD Taşımacılık). M11's Halkalı extension opened **20 June 2026**, days before this map edition.

**Market opportunity:** the official Metro İstanbul app is an information/timetable tool with **no live tracking, no countdowns, no crowding, weak accessibility**, mediocre ratings (~2.4–2.7/5 iOS), and a history of crashing when new lines are added (M11). A polished, **live-map-first** app is a clear differentiation play. The live-train gap is a *product* gap, not purely a data gap.

---

## 2. Real-Time Data Availability

### 2.1 The official channels — what they are and aren't

| Channel | What it gives | Live train positions? |
|---|---|---|
| **Metro İstanbul Mobile API V2** (`api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/`) | `GetLines` (18 lines, RGB color, FirstTime/LastTime), `GetStations` (every station: Id, LineId, Order, lat/lon, FunctionalCode), `GetTimeTable` (POST), `GetDirections`, `GetMaps`, `GetTicketPrice/{lang}`, `GetAnnouncements/{lang}` | **No** — schedule/timetable-centric |
| **Metro İstanbul `SeferDurumlari/SeferDetaylari`** (web) | Per-station first/last train + scheduled departures | **No** — static published timetable |
| **Metro İstanbul `SeferDurumlari/Ariza`** (web) | Line-fault / disruption status | Disruption flags only |
| **İBB static GTFS** (`data.ibb.gov.tr`) | Full GTFS (routes/stops/shapes/stop_times/frequencies) | **No** — and frozen/expired |
| **İETT real-time bus** (`GetVehicleLocations`, "Otobüsüm Nerede") | Live **bus** GPS (~1×/min, speed, plate) | **Buses only, not rail** |

`GetLines` and `GetStations` were both **verified live (HTTP 200, no key)**. `GetTimeTable` is live (returns 405 on GET, validates a model on POST) but the exact `TimeTableRequest` JSON property names **could not be enumerated** — the `/Help` page is behind a WAF/browser gate. This is an open engineering task (capture the mobile app's request, or use a browser session).
- API help/sample: `https://api.ibb.gov.tr/MetroIstanbul/Help/Api/GET-api-MetroMobile-V2-GetLines`
- Verified endpoints: `https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetLines`, `…/GetStations`

### 2.2 Station-arrival vs vehicle-position — the critical distinction

This distinction is the crux of the whole project:

- **Vehicle position** (where a train physically is, second-by-second): **not available** for Istanbul rail from any public source.
- **Station arrival / timetable** (when a train is *scheduled* to depart/arrive a station): **available** via `GetTimeTable` and the static GTFS `stop_times`. This is *scheduled*, not *predicted-from-live*.

So even "next train in N minutes" is, for rail, a **countdown against the schedule**, not a real-time prediction. The app must label predictions as scheduled/estimated and degrade gracefully.

### 2.3 Marmaray / TCDD

Marmaray is operated by **TCDD Taşımacılık**, not Metro İstanbul. Its official timetable lives at `tcddtasimacilik.gov.tr/marmaray/tr/gunluk_tren_saatleri` but is **JS-rendered and not scrapeable as static HTML**; figures in this report for Marmaray came partly from secondary aggregators and need primary confirmation. No official TCDD real-time feed for Marmaray was found. Marmaray *is* present (structurally) in the İBB GTFS and in OSM (route relations `9468040` Gebze→Halkalı, `9987139` Halkalı→Gebze, `ref=B1`).

### 2.4 Unofficial / third-party

- **`Hero4mohamed/Metro-Istanbul-General-City-Map`** ("Ray-Net") — a community live map that uses exactly the recommended approach: OSM-derived geometry + **animated, schedule-based carriages with dwell + predictive arrivals** (not GPS). Confirms the pattern works. **No LICENSE file** — reuse rights unclear.
- **`AydinAdn/IBB.Api`** — documents the İETT/İBB bus `GetVehicleLocations` real-time mechanism (buses only).
- A previously-referenced TS wrapper for `metro.istanbul` now 404s.
- Mobility Database / Transitland — **no confirmed Istanbul rail feed**; pages JS-rendered, Transitland REST returns 401 without a key.

### 2.5 Verdict

> **VERDICT (high confidence):** No official or unofficial real-time vehicle-position feed exists for Istanbul metro/Marmaray. Schedule data (static GTFS + live timetable API) is plentiful and free. The hero "live map" must be a schedule-driven simulation. Confidence is high because three independent streams reached the same conclusion and the absence was checked against both the İBB ecosystem and global aggregators.

---

## 3. Recommended Technical Approach for the Live Map

**Recommendation: a schedule-driven simulation (the Mini Tokyo 3D model), architected so it can become a *hybrid* if any low-frequency live signal becomes available.**

### Why not pure live data
There is no live vehicle feed. Promising GPS truth would be dishonest and impossible to deliver.

### Why not "pure" naive simulation
A flat "2 minutes per station" heuristic (as some calculators like `metrodakikahesapla.com` use) is too crude for a hero feature. We have *much* better inputs: real per-segment run-times from GTFS `stop_times` and real headways from `frequencies.txt` + the live API.

### The recommended approach: **high-fidelity schedule simulation, hybrid-ready**

1. **Geometry layer:** draw each line from İBB line GeoJSON (or GTFS `shapes`, or OSM route relations). Place stations from `GetStations` lat/lon / İBB station points.
2. **Timetable layer:** from `GetTimeTable` (live, authoritative) and static GTFS `stop_times`, build per-trip, per-segment scheduled arrival/departure times.
3. **Spawning:** generate trains at terminals per period-specific headway (peak/base/evening/night), retiring/injecting runs at period boundaries. Use `frequencies.txt` for night/supplemental bands; use enumerated trips where stop_times are explicit.
4. **Interpolation:** at "now," position each active train by interpolating along the line shape between its current segment's stops, using the segment run-time, a small **acceleration/deceleration penalty** on first/short segments, and modeled **dwell**.
5. **Special service patterns:** handle M1A/M1B interlining at the Otogar junction and Marmaray's full + inner short-turn overlay explicitly (see §6).
6. **Honesty layer:** style trains as "estimated," show data freshness, and grey out disrupted/closed segments using `GetAnnouncements`/`Ariza`.
7. **Hybrid hook:** keep an abstraction so that if Metro İstanbul ever ships GTFS-RT VehiclePositions, or if a crowdsourced "GO"-style position signal is added, the engine snaps/corrects to it.

This is exactly how the open-source **Mini Tokyo 3D** animates thousands of trains from GTFS/GTFS-RT (`github.com/nagix/mini-tokyo-3d`, `minitokyo3d.com/docs/master/user-guide/gtfs.html`), and how the community "Ray-Net" map already does Istanbul.

---

## 4. Static & Open Data Inventory

### 4.1 GTFS — the İBB Public Transport feed (rail)

Dataset: **"Toplu Ulaşım GTFS Verisi / Public Transport GTFS Data"** (package id `121a9892-7945-419a-9b89-49f6083926df`). Distributed as **individual CSVs** (not a ZIP), İBB Open Data License, free, no key. Encoding is **Windows-1254** (Turkish) — handle on ingest.

| File | Resource id | Notes |
|---|---|---|
| agency.csv | `42ae499d-ae9c-4906-ac5c-96e0c155e00b` | Metro İstanbul (id 11), TCDD (id 4) |
| calendar.csv | `c84ca913-29ac-4f15-87cd-076aef3dccd6` | service window 2022-12-31 → **2024-12-31 (expired)** |
| frequencies.csv | `a4c86ce6-64da-41e2-9584-5d83b5fb895c` | 2310 rows; headway_secs populated |
| routes.csv | `36b554c7-cae0-4b7e-978f-fc6a43664e88` | route_type 1 metro/Marmaray, 0 tram, 7 funicular |
| shapes.csv | `83317085-aa56-41b0-9447-ea579567f2cb` | line polylines |
| stop_times.csv | `ac646b83-3b6f-4ca2-afb4-9071ab44d9af` | ~11.8 MB, ~199,981 rows; arrival+departure+shape_dist_traveled |
| stops.csv | `d1f7c258-bbc1-406f-9ab2-7a7c1797c673` | |
| trips.csv | `dcee1700-e59f-4a5f-8009-f602045a4507` | |

Base download pattern: `https://data.ibb.gov.tr/dataset/121a9892-7945-419a-9b89-49f6083926df/resource/<id>/download/<name>.csv`
Landing: `https://data.ibb.gov.tr/en/dataset/public-transport-gtfs-data`
CKAN discovery: `https://data.ibb.gov.tr/api/3/action/package_show?id=public-transport-gtfs-data`

**Route IDs (rail):** M1A 1296, M1B 1293, M2 1298, M2A 2044, M3 1297, M3A 2045, M4 1294, M5 7098, M6 3811, M7 28189, M8 28193, M9 28190; T1 4065, T4 1289; F3 7237; Marmaray full 26615, Marmaray1 (B1-style) 26727, Marmaray2 (B2 Halkalı-Bahçeşehir) 28188.

> **Freshness verdict (high confidence):** The feed is explicitly marked "Bu veri güncellenmeyecektir / This data will not be updated." Per-source extracts: Metro İstanbul 2023-01-09, Marmaray 2022-05-24. Calendar ends 2024-12-31. Files Last-Modified ~2024-03. **Treat as a structural/reference feed; refresh all times and the line roster from the live API and metro.istanbul.** Critically, **M11 and recent extensions are absent** from this feed.

A separate **İETT GTFS** dataset (`8540e256-…`) exists but is **buses only** (no rail) and is also static — do not use it for rail.

### 4.2 Operating hours, first/last train, night service, headways (current figures)

These come from official metro.istanbul line pages and the live API and **supersede** the expired GTFS.

- **Standard metro hours:** ~**06:00 – 00:00**, all lines, weekdays and weekends. Per-station first/last via `SeferDurumlari/SeferDetaylari`.
- **Night Metro ("Gece Metrosu"):** continuous **Friday 06:00 → Sunday 00:00** on **M1A, M1B, M2 (excl. Sanayi–Seyrantepe branch), M4, M5, M6, M7**; **30-min headway after 00:00**; **double fare 00:30–05:30**. Source: `metro.istanbul/icerik/Gece-Metrosu`. (The "00:xx FirstTime" values in `GetLines` reflect this weekend all-night service.)
- **Peak headways (official line pages):**
  - **M2** Yenikapı–Hacıosman: **3 min 55 s** main section all day; Sanayi–Seyrantepe shuttle ~8.5 min. 23.49 km, 16 stations, ~32 min end-to-end.
  - **M4** Kadıköy–SAW: peak **5 min**. 33.5 km, 23 stations, ~52 min.
  - **M7** Yıldız–Mahmutbey: peak **4 min**. ~20 km, 17 stations, ~36 min; driverless.
  - **M1A** peak ~6 min; **M1B** peak ~4 min (news sources); combined ~3 min on the shared trunk.
- **Marmaray:** first ~**05:30/06:00** (Halkalı ~05:58 / Gebze ~06:05), last regular ~23:00–00:20. Peak **8–10 min** (core ~8 min), off-peak **15 min**, late night 20–30 min. Weekend (Fri/Sat) extended overnight at 30-min intervals (e.g., last Gebze 01:20 → Halkalı 03:08). *(Confidence medium — confirm against the JS-rendered TCDD page.)*
- **M11** Gayrettepe–İST Airport–Halkalı: ~06:00–00:40; Fri/Sat night services every 30 min; headway ~20 min, denser at peak; Gayrettepe→Airport ~31 min/6 stops. *(Not in GTFS.)*

### 4.3 Reachability status of key static sources

| Source | URL | Status |
|---|---|---|
| İBB Public Transport GTFS (rail) | `data.ibb.gov.tr/en/dataset/public-transport-gtfs-data` | **Reachable, downloaded — frozen/expired** |
| İBB GTFS direct CSV downloads | resource URLs above | **Reachable (HTTP 200), several curl-verified** |
| İBB CKAN API | `data.ibb.gov.tr/api/3/action/package_show?id=public-transport-gtfs-data` | **Reachable** |
| Metro İstanbul line pages | `metro.istanbul/Hatlarimiz/HatDetay?hat=M2` | **Reachable** (M11, F3 404'd at fetch time) |
| Metro İstanbul SeferDetaylari | `metro.istanbul/SeferDurumlari/SeferDetaylari` | **Reachable, JS-rendered** (no static download) |
| Night Metro page | `metro.istanbul/icerik/Gece-Metrosu` | **Reachable** |
| TCDD Marmaray timetable | `tcddtasimacilik.gov.tr/marmaray/tr/gunluk_tren_saatleri` | **Reachable but JS-rendered — not scrapeable as static HTML** |
| İETT GTFS (buses) | `data.ibb.gov.tr/en/dataset/iett-gtfs-verisi` | **Reachable, static, not rail** |
| Mobility Database | `mobilitydatabase.org/feeds` | Reachable; **no confirmed Istanbul rail feed** (JS) |
| Transitland | `transit.land/feeds` | Reachable; REST **401 without key**; no confirmed entry |
| Mirrors (ulasav / b40cities) | `ulasav.csb.gov.tr/dataset/34-public-transport-gtfs-data` | Reachable mirrors of İBB (same staleness) |

No official per-line timetable **PDFs** exist; only dynamic web tools.

---

## 5. Geographic Data — Coordinates & Line Geometry

**Best authoritative source: the İBB Open Data Portal GeoJSONs** (WGS84, free, no key, CKAN-based). Three datasets, each with a `PROJE_ASAMA` (project phase) field that cleanly separates **existing** from **under-construction**, plus a type field (Metro/Tramvay/Banliyö/Füniküler/Teleferik).

1. **Station POINTS** — `rayli_sistem_istasyon_poi_verisi.geojson` — **343 Point features.** Props: `ISTASYON`, `PROJE_ADI`, `HAT_TURU`, `PROJE_ASAMA`, `MUDURLUK`. Breakdown: Metro 213 / Tramvay 77 / Banliyö (Marmaray) 43 / Füniküler 6 / Teleferik 4; existing 268 / under-construction 75. Coords `[lon, lat]`.
   `https://data.ibb.gov.tr/dataset/04ec9805-2483-46c7-914f-30c50857a846/resource/3dc8203f-3613-48a8-85e9-24fffb7821ad/download/rayli_sistem_istasyon_poi_verisi.geojson`
2. **Line GEOMETRIES** — `rayli_sistem_hat_verisi.geojson` — **37 MultiLineString features WITH attributes** (`PROJE_TURU`, `PROJE_AD_KISA`/`PROJE_ADI`, `UZUNLUK` length km, `PROJE_ASAMA`). Covers M1A…M12, T1–T5, F1/F2/F4, teleferiks, Marmaray, plus future segments. File is valid UTF-8.
   `https://data.ibb.gov.tr/dataset/8b8603dd-2642-4789-a891-4bb7cb2c94e8/resource/fe4ec165-9d11-4b83-b031-caea3cfaae55/download/rayli_sistem_hat_verisi.geojson`
3. **Station AREAS (polygons)** — `rayli_sistem_istasyon_verisi.geojson` (footprints).
   `https://data.ibb.gov.tr/dataset/271c7bdf-4b0c-4642-8e50-96acba3d4756/resource/3804f1c6-10de-4fa0-9753-74e5df485d3a/download/rayli_sistem_istasyon_verisi.geojson`
   Discovery: `https://data.ibb.gov.tr/api/3/action/package_search?q=rayl%C4%B1+sistem+istasyon`

**OpenStreetMap (Overpass) — alternative/supplement, free, ODbL attribution.** Complete route relations under `network="İstanbul Metrosu"` (metro/tram/funicular) and `network="Marmaray"`; each direction is a separate relation; carries `ref` + `colour` (hex). **Under-construction lines are present** as `route_master` relations (M12 `15520693`, M13 `15547419`, M20 `15547627`, M34/Hızray `18690177`, M1B-Halkalı `18690036`, etc.). Sample verified IDs:
- Subway (per-direction): M1A 305496/7719077; M1B 4289712/7719075; M2 7719074/11341406 (+Seyrantepe 7719795/7719796); M3 4289797/7719073; M4 2396287/11341395; M5 11344904/11344905; M6 7719780/7719781; M7 11799409/11799410; M8 14900216/14900217; M9 4289800/7719072; M11 15083963/15083964.
- Trams (`route=tram`): T1 151819/2962729, T4 7420264/7420265, T5 12174615/12174616, T3 2409338.
- Funiculars (`route=light_rail`): F1 300961, F2 301616, F3 9476599/9488735, F4 14738977.
- Marmaray (`route=train`, `ref=B1`): Gebze→Halkalı 9468040, Halkalı→Gebze 9987139.
- Endpoint: `https://overpass-api.de/api/interpreter` (export GeoJSON via `overpass-turbo.eu`).

**Wikidata (SPARQL, CC0, no key)** — `query.wikidata.org/sparql`; Istanbul Metro = Q498172, metro-station class Q928830, coords P625. Good cross-check / for Wikipedia links; less complete than İBB/OSM; use line-scoped queries (broad COUNT times out at 504).

**Community ready-made (caution):** `Hero4mohamed/Metro-Istanbul-General-City-Map` `transit_data/lines.json` bundles 23 lines (`{ref, kind, color, paths([lat,lng]), stations}`) + `planned-lines.json`. **No LICENSE — reuse rights unclear; treat as unofficial.** Note `[lat,lng]` order (opposite of GeoJSON).

**Do not use:** the `ustroetz` 2014 Mapzen gist (outdated, missing M5/M7/M8/M9/M11/full Marmaray); `izzetkalic/geojsons-of-turkey` (admin boundaries only, no rail — useful only for district overlays).

**Coverage notes / open items:** confirm a stable join key across points↔lines↔areas (currently `PROJE_ADI` string matching); recover all 43 Marmaray station nodes via route-relation members (a `network=Marmaray` station query returned only 28); verify İBB "İnşaat Aşamasında" flags against actual 2026 openings (some may now be operational, e.g. M11-Halkalı).

---

## 6. Operational Model for Simulation

All figures below were **GTFS-computed** from `stop_times` (run-time = arrival[n] − departure[n−1]; dwell = departure − arrival; distance = Δ`shape_dist_traveled`) unless noted.

### 6.1 Inter-station run times & speeds
- Per-segment run times: metro **~45–285 s** (means ~85–145 s/segment); Marmaray **~145–225 s/segment**.
- Modeled interstation cruise **~45 km/h**; **commercial (end-to-end) speed ~39–41 km/h** across heavy metro and Marmaray.
- Worked examples: **M2** 29.1 min / 19.01 km / 39.2 km/h; **M4** 38.4 min / 25.24 km / 39.4 km/h; **Marmaray** full 111 min / 75.61 km / 40.7 km/h.
- **M11 is the high-speed outlier** (designed for **120 km/h**); all other lines max ~80 km/h. Trams are much slower.
- **Fallback when no schedule:** `run_time = segment_distance / cruise_speed + accel/decel penalty (~10–20 s) + dwell`. Use ~45 km/h metro / ~40–45 km/h Marmaray / 18–25 km/h tram. Distances from `shape_dist_traveled` or station lat/lon along the OSM shape. (Crude alternative: flat ~2 min/station, per `metrodakikahesapla.com` — low fidelity, use only as last resort.)

### 6.2 Dwell time
GTFS encodes a **uniform 15 s placeholder** at every intermediate stop — *not measured.* For realism use: **~20–30 s** interior metro stations, **30–45 s** busy interchanges, **60–90 s** Marmaray; add extra at terminals. *(Real-world secondary sources: ~20–60 s metro, ~60–120 s Marmaray.)*

### 6.3 Terminal turnaround / layover
**Not published by Metro İstanbul.** Use standard transit-sim practice: **3–6 min per terminus** (recovery ≈ 10–20% of one-way run; driverless lines turn faster). This sets the minimum cycle time and the fleet count: **fleet = ⌈round-trip cycle time / headway⌉**. *(Confidence medium.)*

### 6.4 Shared-track / interlining logic
- **M1A/M1B trunk (Yenikapı–Otogar):** classic interlining. Generate trains on the **trunk at ~3-min spacing**, then **alternate branch assignment at the Otogar junction** — M1A toward Atatürk Airport, M1B toward Kirazlı (each branch ~6 min). *(Note: M1A's airport terminus is legacy alignment; validate against live `GetTimeTable`.)*
- **Marmaray (B1/B2-style overlay):** run **two overlaid generators** — a **full Gebze–Halkalı pattern at 15-min** headway and an **inner short-turn (Ataköy/Zeytinburnu–Pendik) at ~8 min** — sharing the central track. GTFS confirms: route 26615 carries 15-min (900 s) bands; route 26727 carries 8-min (480 s) bands 05:50–23:54.

### 6.5 Intraday frequency profile
Most daytime service is **enumerated as discrete trips**; `frequencies.csv` mainly encodes **night/early/late** bands. Driverless lines show clean profiles, e.g. **M7**: 06:00–06:45 = 8 min, 06:45–22:00 = 6 min, 22:00–24:00 = 8 min, 00:20–06:00 = 20 min (night). Practical model: drive spawning from per-period headways (**peak ~3–6 / base ~5–8 / evening ~8–10 / late-night ~10–20 min**) and inject/retire runs at terminals at period boundaries.

### 6.6 Recommended simulation algorithm / architecture
1. Build a **per-line directed graph** of stations from `GetStations` (Order) snapped onto line geometry (İBB GeoJSON / GTFS shapes / OSM).
2. Precompute **segment run-times + distances** from GTFS; overlay **dwell** and **turnaround** constants; store **period headways** from the live API + `frequencies`.
3. A **tick loop** (e.g., 1–4 Hz on client; or server-authoritative) advances a virtual clock; for each active trip, compute fractional progress along the current segment and emit `(lineId, direction, lat, lon, bearing, nextStation, etaNextStation, confidence)`.
4. Handle **branching (M1A/M1B), short-turns (Marmaray), and the Seyrantepe shuttle** as first-class patterns.
5. Apply **service window + Night Metro rules** per line; respect `GetAnnouncements`/`Ariza` to suppress/grey disrupted segments.
6. **Hybrid hook** to snap to any future live/crowdsourced signal.
7. Always emit **confidence/“estimated”** so the UI never overclaims.

---

## 7. Line & Station Inventory (June 2026)

Canonical roster source: **Metro İstanbul "İstanbul Raylı Sistemler Ağ Haritası", v.3 rev.20.0 (Haziran 2026)** — `https://www.metro.istanbul/Content/assets/uploaded/%C4%B0stanbul%20Rayl%C4%B1%20Sistemler%20Haritas%C4%B1.pdf`. Per-line ordered station lists: `metro.istanbul/Hatlarimiz/HatDetay?hat=<CODE>`.

### 7.1 Metro lines (11)
| Line | Termini | Stations | Color (Wikipedia hex*) | Notes |
|---|---|---|---|---|
| **M1A** | Yenikapı – Atatürk Havalimanı | 18 | #EE2229 red | shares trunk w/ M1B to Otogar; legacy airport terminus |
| **M1B** | Yenikapı – Kirazlı | 13 | #EE2229 red | branches at Otogar |
| **M2** | Yenikapı – Hacıosman (+Seyrantepe branch) | 16 | #059A4D green | 3:55 headway; Seyrantepe shuttle |
| **M3** | Bakırköy Sahil – Kayaşehir Merkez | 20 | #0CA6DF light blue | extended to Kayaşehir Mar 2024 |
| **M4** | Kadıköy – Sabiha Gökçen Havalimanı | 23 | #E81E77 pink | airport ext. Oct 2022 |
| **M5** | Üsküdar – Sultanbeyli | 24 | #683166 purple | first Asian-side driverless |
| **M6** | Levent – Boğaziçi Ü./Hisarüstü | 4 | #C9AA79 gold | shortest line |
| **M7** | Yıldız – Mahmutbey | 17 | #F490B3 light pink | fully driverless |
| **M8** | Bostancı – Parseller | 13 | #487ABF blue | driverless |
| **M9** | Ataköy – Olimpiyat | 14 | #FCD10D yellow | staged 2021–2024 |
| **M11** | Gayrettepe – İST Airport – Halkalı | 16 | #A1609B mauve | **Halkalı ext. opened 20 Jun 2026**; ~69 km, up to 120 km/h |

\*Hex codes are **Wikipedia community values** (`Module:Adjacent_stations/Istanbul_Metro`), aligned with the map but **not confirmed as official brand hex** — see §10.

### 7.2 Trams, funiculars, cable cars
- **T1** Kabataş–Bağcılar (31 stations, #004B86). **T3** Kadıköy–Moda nostalgic loop (~10–11 stops, #99562F). **T4** Topkapı–Mescid-i Selam (22, #FF7E42). **T5** Eminönü–Alibeyköy Cep Otogarı (14, #7B72B2). **T6** Sirkeci–Kazlıçeşme (TCDD shuttle, ~8 stops, #E77C7C). **T2** Taksim–Tünel **nostalgic** (İETT, İstiklal Cd.).
- **F1** Taksim–Kabataş; **F3** Seyrantepe–Vadistanbul; **F4** Hisarüstü–Aşiyan (all Metro İstanbul, #7A745A). **F2** Karaköy–Beyoğlu **heritage Tünel** (İETT, since 1875 — keep separate).
- **TF1** Maçka–Taşkışla; **TF2** Eyüp–Piyer Loti (cable cars).

### 7.3 Marmaray & suburban (TCDD)
- **Marmaray** Halkalı–Gebze, **43 stations**, ~76.6 km, full run ~108–115 min, ~4 min under the Bosphorus. Legend codes: **B1** = Halkalı–Gebze (Marmaray-TCDD).
- **B2** Halkalı–Bahçeşehir Banliyö (TCDD) — separate western suburban service in the map legend; full station list / operational status needs a dedicated TCDD check.

### 7.4 Key transfers (aktarma)
Yenikapı (M1A+M1B+M2+Marmaray); Gayrettepe (M2+M11); Şişli-Mecidiyeköy/Mecidiyeköy (M2↔M7↔Metrobüs); Kirazlı-Bağcılar (M1B+M3); Mahmutbey (M3+M7); Üsküdar (M5+Marmaray); Ayrılık Çeşmesi (M4↔Marmaray); Kadıköy (M4+T3+ferry); Bostancı (M4+M8+Marmaray); Kozyatağı (M4+M8); Kağıthane (M7+M11); Alibeyköy (M7+T5); Kabataş (T1+F1+ferry); Taksim (M2+F1+T2); Levent (M2+M6); Ataköy (M9+Marmaray); Yenibosna (M1A+M9). Map is authoritative for transfer symbols.

### 7.5 Under-construction / planned (for an extensible data model)
M10 (Pendik–SGH), **M12** Göztepe–Ümraniye (~end-2026 target), **M13** Emek/Yenidoğan–Söğütlüçeşme, M14 Altunizade–Bosna Bulvarı, M1B Kirazlı–Halkalı, M4 Tavşantepe–Tuzla, M7 Kabataş–Yıldız & Mahmutbey–Esenyurt, M20 İncirli–Beylikdüzü, M34 "Hızray", **T7** Eyüpsultan–Bayrampaşa. Both İBB (`PROJE_ASAMA="İnşaat Aşamasında"`) and OSM `route_master` relations carry these.

**Data-model implication:** make line/station config **data-driven** (never hardcoded) — the official app's M11 crash shows the cost of hardcoding. Model branches (M1A/M1B), shuttles (M2-Seyrantepe), short-turns (Marmaray), multi-operator ownership (Metro İstanbul vs TCDD vs İETT), and `phase` (existing/under-construction) as first-class fields.

---

## 8. Product Analysis — Official App & Best-in-Class Patterns

### 8.1 Official Metro İstanbul app
- **What it is:** an **information + static-timetable** app (Dec 2019 redesign), five tabs: *Nasıl Giderim, Sefer Tarifeleri, Ağ Haritaları, Hattınızı Seçin, Bilet & Ücretler*. TR/EN, nearest-station, network map, fares, news.
- **What it lacks:** live train positions, next-train countdowns, real-time delays, crowding, step-free/accessibility routing, precise exit guidance, equipment-status info.
- **Ratings:** ~**2.4–2.7/5 iOS** (small samples, multiple/legacy listings split ratings: ids `570644574`, `393533466`), ~3.6/5 Android (aggregators).
- **Complaints (Şikayetvar, store reviews):** **crashes after line additions (M11)**; inaccurate arrival estimates ("says 4 min, never comes"); poor disruption communication; broken escalators/elevators left uncommunicated; QR/payment errors.
- **Key insight:** İBB already ships live **bus** tracking ("Otobüsüm Nerede") and publishes GTFS — so the live-rail gap is a **product** gap, an opening for us.

### 8.2 Best-in-class patterns to adopt
- **Citymapper:** "GO" live-trip mode; **subscribe-to-line** push delay alerts; **which carriage to board**; route variants (Walk less / Simple / Turbo); live trip sharing.
- **Transit:** **nearby-departures-first** home screen; **GO crowdsourcing** (riders become beacons) — a model for our hybrid hook; Live Activities / Dynamic Island countdown; Apple Watch.
- **Moovit:** moving-vehicle **live location** on map; **get-off alerts**; **real-time crowding** (Available / Standing / Crowded); AR wayfinder.
- **TfL Go:** live map that **greys out closed/disrupted** sections; **step-free mode** with platform-level detail (gap width, step height); station busyness; VoiceOver + Dynamic Type.
- **New MTA app:** real-time position + **platform boarding markers**; **per-car crowding**; accessibility map mode; **elevator/escalator status**.
- **Trafi / third-party Istanbul apps:** moving-vehicle map, **offline maps**, **trip-cost calculator**, AR nearest-station — proving local demand the official app underserves.

### 8.3 Pitfalls to avoid
Inaccurate ETAs (show freshness/confidence, degrade gracefully); brittle hardcoded line config (M11 crash → make it data-driven); static timetables masquerading as "live" (clearly label scheduled vs real-time); buried disruption info (surface on map + push); fragmented duplicate store listings; neglected accessibility.

---

## 9. Recommended Feature Set (Prioritized)

*The live-position experience is the hero throughout. Tiers below merge the user's listed features with high-value additions from Transit/Citymapper/Moovit/TfL Go.*

### MVP (MUST)
1. **Realistic live train-position map** — schedule/headway interpolation along line geometry, trains animate between stations, per-direction, styled "estimated" with confidence. **(Hero.)**
2. Line list + **per-line live status** (running/disrupted/closed) via `GetLines` + `GetAnnouncements`/`Ariza`.
3. **Next-train / approaching-trains** per station + first/last train + frequency (timetable-driven).
4. **# of trains currently running** per line (derived from the simulation).
5. **Station detail:** location, transfers, exits, accessibility (elevator/escalator), facilities (WC/parking/bike).
6. **Nearest station** ("near me"); map search + filtering (line/mode/accessibility).
7. **Favorites** (stations + lines) + recent searches.
8. **Out-of-service / maintenance alerts + announcements** (multilingual).
9. **Multi-language** (TR/EN min.) via `GetAnnouncements/{lang}`, `GetTicketPrice/{lang}`.
10. **Dark/light theme**; **journey-time + transfer calc** between two stations (offline from GTFS).

### v1.1 (SHOULD)
1. **GO-style trip companion** — Live Activity / Dynamic Island remaining-stops countdown + "get off next" alert.
2. **Line-subscription push** for disruptions on favorite lines/stations.
3. **Simulated crowding** (Available/Standing/Crowded) from headway + time-of-day, clearly labeled *estimated*.
4. **Full A-to-B multimodal trip planning** incl. Marmaray/tram/metrobüs.
5. **Offline maps + cached schedules** (works underground).
6. **Home-screen widgets + Apple Watch / Wear** complications.
7. **"Which exit" / "best car to board"** (OSM `subway_entrance`, `destination:carriages`).
8. **Share live ETA** of an in-progress trip.

### Later (COULD)
3D map mode + **time-machine playback**; fare/İstanbulkart info + transfer-discount calculator (**deep-link** to the İstanbulkart app); indoor station maps; **crowd-sourced confirmations** (delay/crowding) to refine estimates (and feed the hybrid hook); planned-works calendar; personalized commute card; CarPlay/Android Auto.

### Won't (now)
- **Native İstanbulkart top-up / Apple Wallet Express Transit** — **not supported in Turkey** (iPhone NFC top-up blocked); deep-link only.
- **True GPS per-train tracking** — no public feed; would be dishonest.
- **In-app ticket purchase/payment.**

---

## 10. Design System Foundations

> **Engineering recommendation** — there was no dedicated design-system research stream in the input. The brand colors below are sourced; the rest is opinionated synthesis against MD3 / Apple HIG / 2026 norms and should be validated with a designer.

- **Line colors:** seed from the verified hex set in §7.1 (`Module:Adjacent_stations/Istanbul_Metro`), **but validate against the official map PDF swatches** before treating as brand-exact — Metro İstanbul has not published a text hex palette. Store colors in line config so the map, legends, and route badges stay consistent. Ensure WCAG-AA contrast for labels on each line color (e.g., yellow M9, gold M6 need dark text/outlines).
- **Map rendering tech (recommendation):** a **vector map library with custom animated overlays** — **MapLibre GL** (open, no vendor lock-in, MBTiles/vector tiles, smooth GPU animation of many moving markers) is the strongest fit and aligns with the Mini Tokyo 3D approach (which uses Mapbox/MapLibre + Three.js for a 3D variant). Render lines as styled GeoJSON sources; render trains as a frequently-updated symbol/circle layer or a Three.js layer for 3D. Keep the schematic ("metro map" diagram) and geographic views as two modes.
- **Cross-platform standards:** MD3 (Material 3) on Android (dynamic color optional, but line colors should remain canonical), **Apple HIG** on iOS (Live Activities, Dynamic Island, Watch complications — all explicitly leveraged in §9). Support **Dynamic Type / large text, VoiceOver/TalkBack**, dark/light, and a **step-free mode** (TfL Go pattern) as first-class — accessibility is a stated differentiator.
- **Motion principles:** trains should move **smoothly and continuously** (interpolated, eased between segments), not teleport stop-to-stop; dwell pauses visible at stations; disrupted segments greyed/animated-off; "estimated" trains rendered with a subtle confidence treatment (e.g., soft glow/dashed halo) so users never mistake simulation for GPS. Respect "reduce motion" settings.

---

## 11. Recommended Tech Stack & Architecture

> **Engineering recommendation** — no dedicated tech-stack stream was supplied; this is opinionated synthesis consistent with the data constraints.

- **Frontend:** **Flutter** (single codebase iOS+Android, strong custom-rendering/animation performance for the live map; good widget control for the schematic map) **or** React Native if web reuse matters more. Given the heavy custom-animation hero feature and dual-platform parity goal, **Flutter is the primary recommendation**; pair with `maplibre_gl`/`flutter-maplibre`.
- **Map library:** **MapLibre GL** (vector, open, animated marker layers). Optional **Mini Tokyo 3D-style Three.js** layer for a "3D" later-tier mode.
- **Where the simulation runs:** **server-authoritative simulation with a thin client renderer.** A backend service ingests the data pipeline output (static dataset + periodic live-API timetable refresh), runs the tick engine, and exposes **(a)** a lightweight **WebSocket/SSE** stream of active-train states for the live map and **(b)** REST for station/line/timetable queries. Rationale: one consistent simulation for all users, easy to correct/snap if a live signal ever appears, and the client stays simple and battery-friendly. Keep a **client-side fallback simulator** (same engine compiled for the app) for **offline use underground** — seeded from the last server sync + cached schedules.
- **Data pipeline (build the static dataset):**
  1. Pull **İBB GTFS** (structure, shapes, stop_times, frequencies) + **İBB GeoJSON** (line geometry, station points, phase flags) + **OSM/Overpass** (geometry/entrances supplement, under-construction).
  2. **Refresh times + roster** from the **live Metro İstanbul API** (`GetLines`/`GetStations`/`GetTimeTable`) and metro.istanbul line pages — overriding the expired GTFS.
  3. Normalize encoding (Windows-1254 → UTF-8), reconcile join keys (`PROJE_ADI`), resolve `[lat,lng]` vs `[lon,lat]` order, and tag operator/phase/branch/short-turn.
  4. Emit a versioned, **data-driven config** (lines, stations, segments, run-times, dwell, headway profiles, turnaround) consumed by the simulation engine.
  5. Schedule periodic re-pulls (live API is source of truth) + an alerting cron that watches for roster changes (new lines/extensions) so the app never breaks like the official one did on M11.
- **Disruptions:** poll `GetAnnouncements` + `Ariza`; map disruptions onto line segments to grey/animate-off and to drive line-subscription push.
- **Attribution/licensing:** İBB Open Data License (confirm redistribution/attribution terms); ODbL for OSM; CC0 for Wikidata; **avoid** the unlicensed community repo for shipped data.

---

## 12. Key Risks, Open Questions & Next-Steps Checklist

### Risks
- **No live position feed (core risk):** hero is a simulation; mislabeling it as GPS would erode trust (the #1 official-app complaint is bad ETAs). **Mitigation:** confidence styling + "estimated," graceful degradation.
- **Stale/expired static GTFS + missing new lines (M11, extensions):** **Mitigation:** treat GTFS as structure-only; refresh times/roster from the live API; data-driven config + roster-change alerting.
- **Live API fragility:** undocumented `GetTimeTable` schema; WAF/browser gate on `/Help`; uncertain rate limits; possible silent changes. **Mitigation:** capture/confirm the POST schema; cache aggressively; monitor for drift.
- **Marmaray/TCDD data gap:** timetable is JS-rendered, no real-time, B2 status unclear; current Marmaray figures partly from secondary sources. **Mitigation:** primary-confirm from TCDD; model B1/B2 explicitly.
- **Licensing:** İBB terms not fully confirmed; community repo unlicensed; ensure ODbL/İBB/CC0 attribution.
- **Operational unknowns:** dwell (15 s placeholder) and turnaround (unpublished) are estimates — simulation accuracy depends on them.
- **Platform constraint:** İstanbulkart/Apple Wallet unavailable in TR — deep-link only.

### Open questions (highest priority first)
1. **Is there ANY current GTFS-static or GTFS-RT for Istanbul rail** beyond the expired İBB feed? (Re-check İBB developer channels, `api.ibb.gov.tr`, IETT SOAP/REST ecosystem.)
2. **Exact `GetTimeTable` POST schema** (`TimeTableRequest` fields; Direction/Day codes) — capture the mobile app's request.
3. **Official Marmaray numbers** (per-terminus first/last, peak vs off-peak) **from TCDD primary**; **B2 Halkalı–Bahçeşehir** station list/status.
4. **Live-API freshness** for recently changed services (M1A post-airport, M3/M9 extensions, M5→Sultanbeyli, M11-Halkalı).
5. **Official brand hex palette** (validate Wikipedia hex vs map PDF swatches; seek a Metro İstanbul style guide).
6. **İBB GeoJSON join keys** (stable per-line/per-station IDs) and **all 43 Marmaray station nodes** in OSM.
7. **Any occupancy/crowding data source** an app could surface (else fully simulated).
8. **Real dwell/turnaround** (derive from live timetable arrival/departure deltas; academic studies).

### Next-steps checklist
- [ ] Confirm İBB Open Data License redistribution/attribution terms.
- [ ] Capture & document the `GetTimeTable` POST schema; verify `GetLines`/`GetStations`/`GetDirections` for all 11 metro + funiculars/trams.
- [ ] Build the **data pipeline v0**: ingest İBB GTFS + GeoJSON + OSM, refresh times/roster from live API, emit versioned data-driven config (UTF-8, reconciled keys, branch/short-turn/phase tags).
- [ ] Stand up the **server-side simulation engine** (segment run-times + dwell + turnaround + headway profiles; M1A/M1B branching, Marmaray B1/B2 overlay, Seyrantepe shuttle, Night Metro rules) with a WebSocket/SSE train-state stream.
- [ ] Prototype the **MapLibre live map** rendering animated, eased, "estimated"-styled trains over İBB/OSM line geometry; greying disrupted segments from `GetAnnouncements`/`Ariza`.
- [ ] Primary-confirm **Marmaray** timetable from TCDD; resolve **B2** status.
- [ ] Validate **line colors** against the official map PDF; build the line/station **data-driven config** so new lines never crash the app.
- [ ] Wire **MVP feature set** (§9) around the hero; add **confidence/freshness UI** and a clear scheduled-vs-real-time disclosure.
- [ ] Implement **offline cache + client fallback simulator** for underground use.
- [ ] Plan the **hybrid hook** (crowdsourced GO-style positions or future GTFS-RT) and **roster-change monitoring** cron.