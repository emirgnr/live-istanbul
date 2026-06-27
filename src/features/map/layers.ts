import type maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { NetworkSnapshot } from '@/lib/network/types'
import { network } from '@/data'
import { allLines, segmentsForLine } from '@/data'
import { LABEL_FONT, type BaseTheme } from './mapStyle'

export const SOURCES = {
  construction: 'mli-construction',
  lines: 'mli-lines',
  stations: 'mli-stations',
  trains: 'mli-trains',
} as const

export const LAYERS = {
  construction: 'mli-construction',
  linesCasing: 'mli-lines-casing',
  lines: 'mli-lines',
  stations: 'mli-stations',
  stationLabels: 'mli-station-labels',
  trainsGlow: 'mli-trains-glow',
  trains: 'mli-trains',
} as const

// ---------------------------------------------------------------------------
// static GeoJSON (lines + stations) — built once from the dataset
// ---------------------------------------------------------------------------
export function buildLinesGeoJSON(): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const line of allLines()) {
    const segs = segmentsForLine(line.id)
    if (!segs.length) continue
    const coords: number[][] = [segs[0].geometry[0]]
    for (const s of segs) for (let i = 1; i < s.geometry.length; i++) coords.push(s.geometry[i])
    features.push({
      type: 'Feature',
      properties: { id: line.id, code: line.code, color: line.color, mode: line.mode },
      geometry: { type: 'LineString', coordinates: coords },
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
  const features: Feature<Point>[] = []
  for (const st of Object.values(network.stations)) {
    const primary = st.lines[0]
    const color = primary ? network.lines[primary]?.color ?? '#888' : '#888'
    features.push({
      type: 'Feature',
      properties: {
        id: st.id,
        name: st.name.tr,
        transfer: st.isTransfer ? 1 : 0,
        color,
        lineCount: st.lines.length,
      },
      geometry: { type: 'Point', coordinates: st.coord },
    })
  }
  return { type: 'FeatureCollection', features }
}

const lineColorById: Record<string, string> = Object.fromEntries(
  Object.values(network.lines).map((l) => [l.id, l.color]),
)

export function trainsToGeoJSON(snap: NetworkSnapshot): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: snap.trains.map((t) => ({
      type: 'Feature',
      properties: {
        id: t.id,
        lineId: t.lineId,
        color: lineColorById[t.lineId] ?? '#888',
        bearing: t.bearing,
        phase: t.phase,
        dir: t.direction,
      },
      geometry: { type: 'Point', coordinates: t.coord },
    })),
  }
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
  map.addSource(SOURCES.trains, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

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

  // line casing (subtle contrast halo under colored lines)
  map.addLayer({
    id: LAYERS.linesCasing,
    type: 'line',
    source: SOURCES.lines,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': casing,
      'line-opacity': theme === 'dark' ? 0.5 : 0.9,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 13, 7, 16, 11],
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
    },
  })

  // stations
  map.addLayer({
    id: LAYERS.stations,
    type: 'circle',
    source: SOURCES.stations,
    minzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 4, 16, 7],
      'circle-color': stationFill,
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'transfer'], 1],
        theme === 'dark' ? '#e9eef6' : '#1f2630',
        ['get', 'color'],
      ],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.2],
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

  // train glow
  map.addLayer({
    id: LAYERS.trainsGlow,
    type: 'circle',
    source: SOURCES.trains,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 13, 9, 16, 14],
      'circle-color': ['get', 'color'],
      'circle-blur': 1,
      'circle-opacity': 0.35,
    },
  })

  // train dot
  map.addLayer({
    id: LAYERS.trains,
    type: 'circle',
    source: SOURCES.trains,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 5.5, 16, 8],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': stationStroke,
      'circle-stroke-width': 1.6,
      'circle-pitch-alignment': 'map',
    },
  })
}

export function updateTrains(map: maplibregl.Map, snap: NetworkSnapshot) {
  const src = map.getSource(SOURCES.trains) as maplibregl.GeoJSONSource | undefined
  src?.setData(trainsToGeoJSON(snap))
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
  map.setPaintProperty(
    LAYERS.trains,
    'circle-opacity',
    selectedLineId ? ['case', isSel('lineId'), 1, 0.12] : 1,
  )
  map.setPaintProperty(
    LAYERS.trainsGlow,
    'circle-opacity',
    selectedLineId ? ['case', isSel('lineId'), 0.45, 0.04] : 0.35,
  )
}
