import type maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Journey } from '@/lib/journey/plan'
import { network, geo } from '@/data'
import { getStation, segmentsForLine } from '@/data'
import { LABEL_FONT, type BaseTheme } from './mapStyle'

const EMPTY_FC: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] }

export const SOURCES = {
  construction: 'mli-construction',
  lines: 'mli-lines',
  stations: 'mli-stations',
  journey: 'mli-journey',
} as const

export const LAYERS = {
  construction: 'mli-construction',
  linesCasing: 'mli-lines-casing',
  lines: 'mli-lines',
  stations: 'mli-stations',
  stationLabels: 'mli-station-labels',
  journeyCasing: 'mli-journey-casing',
  journey: 'mli-journey',
  journeyWalk: 'mli-journey-walk',
} as const

// ---------------------------------------------------------------------------
// static GeoJSON (lines + stations) — from the PER-LINE geo dataset (build-geo.mjs).
// Each line carries its shared-corridor `off` rank (for parallel-ribbon rendering);
// stations are per-line entities, so a stop shared by several lines is emitted once
// PER LINE as its OWN separate point — co-located stops are never merged.
// ---------------------------------------------------------------------------
const lineColor: Record<string, string> = Object.fromEntries(geo.lines.map((l) => [l.line_id, l.color]))

export function buildLinesGeoJSON(): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const line of geo.lines) {
    if (line.geometry.length < 2) continue
    features.push({
      type: 'Feature',
      properties: { id: line.line_id, color: line.color, off: line.off },
      geometry: { type: 'LineString', coordinates: line.geometry },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function buildConstructionGeoJSON(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: (network.construction ?? []).map((c) => ({
      type: 'Feature',
      properties: { code: c.code, name: c.name },
      geometry: { type: 'LineString', coordinates: c.geometry },
    })),
  }
}

export function buildStationsGeoJSON(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: geo.stations.map((s) => ({
      type: 'Feature',
      // `refId` bridges a map click back to the base station record (panel/arrivals/journey
      // still run on the merged `network`); `lineId` scopes it to this line.
      properties: {
        id: s.station_id,
        refId: s.ref_id,
        lineId: s.line_id,
        name: s.station_name,
        color: lineColor[s.line_id] ?? '#888',
        terminus: s.terminus,
      },
      geometry: { type: 'Point', coordinates: s.coordinates },
    })),
  }
}

/** Geometry of just the traveled route (ride legs follow the rail; walk legs straight). */
export function buildJourneyGeoJSON(plan: Journey): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const leg of plan.legs) {
    if (leg.type === 'ride') {
      const pair = new Map<string, number[][]>()
      for (const s of segmentsForLine(leg.lineId)) pair.set(`${s.from}|${s.to}`, s.geometry)
      const coords: number[][] = []
      for (let i = 0; i < leg.stationIds.length - 1; i++) {
        const a = leg.stationIds[i]
        const b = leg.stationIds[i + 1]
        let g = pair.get(`${a}|${b}`)
        let rev = false
        if (!g) {
          g = pair.get(`${b}|${a}`)
          rev = true
        }
        if (!g) {
          const sa = getStation(a)
          const sb = getStation(b)
          g = sa && sb ? [sa.coord, sb.coord] : undefined
          rev = false
        }
        if (!g) continue
        const gg = rev ? g.slice().reverse() : g
        for (const p of gg) {
          const last = coords[coords.length - 1]
          if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p)
        }
      }
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { color: network.lines[leg.lineId]?.color ?? '#888', kind: 'ride' },
          geometry: { type: 'LineString', coordinates: coords },
        })
      }
    } else if (leg.type === 'access') {
      // walking between an off-network place and a station (or place→place)
      features.push({
        type: 'Feature',
        properties: { color: '#7a8699', kind: 'walk' },
        geometry: { type: 'LineString', coordinates: [leg.placeCoord, leg.otherCoord] },
      })
    } else {
      const a = getStation(leg.from)
      const b = getStation(leg.to)
      if (a && b)
        features.push({
          type: 'Feature',
          properties: { color: '#7a8699', kind: 'walk' },
          geometry: { type: 'LineString', coordinates: [a.coord, b.coord] },
        })
    }
  }
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// add sources + layers to a loaded map
// ---------------------------------------------------------------------------
export function addNetworkLayers(map: maplibregl.Map, theme: BaseTheme) {
  const casing = theme === 'dark' ? '#0a0e14' : '#ffffff'
  const labelColor = theme === 'dark' ? '#e9eef6' : '#1f2630'
  const labelHalo = theme === 'dark' ? '#0a0e14' : '#ffffff'
  const stationStroke = theme === 'dark' ? '#0a0e14' : '#ffffff'
  const stationFill = theme === 'dark' ? '#e9eef6' : '#ffffff'

  map.addSource(SOURCES.construction, { type: 'geojson', data: buildConstructionGeoJSON() })
  map.addSource(SOURCES.lines, { type: 'geojson', data: buildLinesGeoJSON() })
  map.addSource(SOURCES.stations, { type: 'geojson', data: buildStationsGeoJSON() })
  map.addSource(SOURCES.journey, { type: 'geojson', data: EMPTY_FC })

  // under-construction lines (dashed, muted) — beneath everything
  map.addLayer({
    id: LAYERS.construction,
    type: 'line',
    source: SOURCES.construction,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': theme === 'dark' ? '#5b6675' : '#9aa6ba',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3, 16, 5],
      'line-dasharray': [2, 2.5],
      'line-opacity': 0.7,
    },
  })

  // line casing (subtle contrast halo under colored lines). Pale lines (e.g. the
  // Metrobüs khaki #DED59A) wash out against the light basemap and look broken at
  // every white stop dot, so on the light theme they get a darker khaki outline
  // instead of the white casing — making the line read as continuous.
  map.addLayer({
    id: LAYERS.linesCasing,
    type: 'line',
    source: SOURCES.lines,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color':
        theme === 'dark'
          ? casing
          : ['case', ['==', ['get', 'id'], 'METROBUS'], '#9c8f45', casing],
      'line-opacity': theme === 'dark' ? 0.5 : 0.9,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 13, 7, 16, 11],
      // parallel-ribbon offset for shared corridors, scaled with zoom to track line width
      // (zoom must be the top-level interpolate input; each stop is data-driven via `off`)
      'line-offset': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['*', ['get', 'off'], 3],
        13,
        ['*', ['get', 'off'], 5.5],
        16,
        ['*', ['get', 'off'], 9],
      ],
    },
  })

  // colored lines
  map.addLayer({
    id: LAYERS.lines,
    type: 'line',
    source: SOURCES.lines,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 13, 4.5, 16, 8],
      'line-offset': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['*', ['get', 'off'], 3],
        13,
        ['*', ['get', 'off'], 5.5],
        16,
        ['*', ['get', 'off'], 9],
      ],
    },
  })

  // stations — regular = hollow (white fill + line-colored ring); terminus = filled
  // (the line-end convention, a per-line property). Interchange/transfer cues are
  // intentionally NOT drawn on the geo map — transfer info lives only in the detail panel
  // and the scheme view. The map shows only lines and station points.
  const ink = theme === 'dark' ? '#e9eef6' : '#101418' // terminus fill ("black" per official sign)
  map.addLayer({
    id: LAYERS.stations,
    type: 'circle',
    source: SOURCES.stations,
    minzoom: 10,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', ['==', ['get', 'terminus'], 1], 3, 2],
        13,
        ['case', ['==', ['get', 'terminus'], 1], 5, 4],
        16,
        ['case', ['==', ['get', 'terminus'], 1], 8, 6.5],
      ],
      'circle-color': ['case', ['==', ['get', 'terminus'], 1], ink, stationFill],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'terminus'], 1],
        stationStroke,
        ['get', 'color'],
      ],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.3, 14, 2.2],
    },
  })

  // station labels (higher zoom)
  map.addLayer({
    id: LAYERS.stationLabels,
    type: 'symbol',
    source: SOURCES.stations,
    minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': LABEL_FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 16, 13],
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 4,
    },
    paint: {
      'text-color': labelColor,
      'text-halo-color': labelHalo,
      'text-halo-width': 1.4,
    },
  })

  // planned-journey highlight (only the traveled portion). Hidden until a route exists.
  map.addLayer({
    id: LAYERS.journeyCasing,
    type: 'line',
    source: SOURCES.journey,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': casing,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 13, 11, 16, 16],
    },
  })
  map.addLayer({
    id: LAYERS.journey,
    type: 'line',
    source: SOURCES.journey,
    filter: ['==', ['get', 'kind'], 'ride'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 13, 6.5, 16, 10],
    },
  })
  map.addLayer({
    id: LAYERS.journeyWalk,
    type: 'line',
    source: SOURCES.journey,
    filter: ['==', ['get', 'kind'], 'walk'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 4, 16, 6],
      'line-dasharray': [1, 1.6],
    },
  })
}

/** Show/hide the planned-route highlight and dim the rest of the network behind it. */
export function updateJourney(map: maplibregl.Map, plan: Journey | null) {
  if (!map.getLayer(LAYERS.journey)) return
  const active = !!plan && plan.legs.length > 0
  const src = map.getSource(SOURCES.journey) as maplibregl.GeoJSONSource | undefined
  src?.setData(active && plan ? buildJourneyGeoJSON(plan) : EMPTY_FC)
  const vis = active ? 'visible' : 'none'
  for (const id of [LAYERS.journeyCasing, LAYERS.journey, LAYERS.journeyWalk])
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  if (active) {
    map.setPaintProperty(LAYERS.lines, 'line-opacity', 0.12)
    map.setPaintProperty(LAYERS.linesCasing, 'line-opacity', 0.04)
  }
}

/** Bounding box [[minX,minY],[maxX,maxY]] of a journey's geometry, or null. */
export function journeyBounds(plan: Journey): maplibregl.LngLatBoundsLike | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of buildJourneyGeoJSON(plan).features)
    for (const [x, y] of f.geometry.coordinates) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  if (minX === Infinity) return null
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/** Emphasize one line and dim the rest (null = show everything normally). */
export function setSelection(map: maplibregl.Map, selectedLineId: string | null) {
  if (!map.getLayer(LAYERS.lines)) return
  const isSel = (key: string) => ['==', ['get', key], selectedLineId]

  map.setPaintProperty(
    LAYERS.lines,
    'line-opacity',
    selectedLineId ? ['case', isSel('id'), 1, 0.16] : 1,
  )
  map.setPaintProperty(
    LAYERS.lines,
    'line-width',
    selectedLineId
      ? [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          ['case', isSel('id'), 3.5, 1.5],
          13,
          ['case', isSel('id'), 6.5, 3.5],
          16,
          ['case', isSel('id'), 11, 6],
        ]
      : ['interpolate', ['linear'], ['zoom'], 9, 2, 13, 4.5, 16, 8],
  )
  map.setPaintProperty(
    LAYERS.linesCasing,
    'line-opacity',
    selectedLineId ? ['case', isSel('id'), 0.95, 0.04] : 0.85,
  )
}
