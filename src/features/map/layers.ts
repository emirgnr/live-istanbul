import type maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { NetworkSnapshot } from '@/lib/network/types'
import type { Journey } from '@/lib/journey/plan'
import { network } from '@/data'
import { allLines, getStation, segmentsForLine } from '@/data'
import { LABEL_FONT, type BaseTheme } from './mapStyle'
import { addPoiIcons, addTrainArrow, addTrainStop } from './icons'
import type { TrainSnapshot } from '@/lib/network/types'

const EMPTY_FC: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] }

export const SOURCES = {
  construction: 'mli-construction',
  transfersLink: 'mli-transfers-link',
  lines: 'mli-lines',
  stations: 'mli-stations',
  journey: 'mli-journey',
  trains: 'mli-trains',
  trainSelected: 'mli-train-selected',
} as const

export const LAYERS = {
  construction: 'mli-construction',
  transfersLink: 'mli-transfers-link',
  transfersLinkFill: 'mli-transfers-link-fill',
  linesCasing: 'mli-lines-casing',
  lines: 'mli-lines',
  stations: 'mli-stations',
  poi: 'mli-poi',
  stationLabels: 'mli-station-labels',
  journeyCasing: 'mli-journey-casing',
  journey: 'mli-journey',
  journeyWalk: 'mli-journey-walk',
  trainSelectedHalo: 'mli-train-selected-halo',
  trainsBloom: 'mli-trains-bloom',
  trainsGlow: 'mli-trains-glow',
  trains: 'mli-trains',
  trainsArrow: 'mli-trains-arrow',
  trainsDwell: 'mli-trains-dwell',
  trainSelectedRing: 'mli-train-selected-ring',
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
        terminus: st.isTerminus ? 1 : 0,
        poi: st.poi ?? '',
        color,
        lineCount: st.lines.length,
      },
      geometry: { type: 'Point', coordinates: st.coord },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function buildTransfersGeoJSON(): FeatureCollection<LineString> {
  const byId = network.stations
  return {
    type: 'FeatureCollection',
    features: (network.transfers ?? []).map((t) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [byId[t.a].coord, byId[t.b].coord] },
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

  addPoiIcons(map)
  addTrainArrow(map)
  addTrainStop(map)
  map.addSource(SOURCES.construction, { type: 'geojson', data: buildConstructionGeoJSON() })
  map.addSource(SOURCES.transfersLink, { type: 'geojson', data: buildTransfersGeoJSON() })
  map.addSource(SOURCES.lines, { type: 'geojson', data: buildLinesGeoJSON() })
  map.addSource(SOURCES.stations, { type: 'geojson', data: buildStationsGeoJSON() })
  map.addSource(SOURCES.journey, { type: 'geojson', data: EMPTY_FC })
  map.addSource(SOURCES.trains, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addSource(SOURCES.trainSelected, {
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

  // walking-transfer connectors styled as the official "linked circles" interchange
  // marker: a dark-outlined white neck joining the two station circles
  const ring = theme === 'dark' ? '#e9eef6' : '#1f2630'
  map.addLayer({
    id: LAYERS.transfersLink,
    type: 'line',
    source: SOURCES.transfersLink,
    minzoom: 11,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ring,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 7, 16, 11],
    },
  })
  map.addLayer({
    id: LAYERS.transfersLinkFill,
    type: 'line',
    source: SOURCES.transfersLink,
    minzoom: 11,
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': stationFill,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14, 3.2, 16, 6],
    },
  })

  // stations — official map conventions:
  //   regular = hollow (white fill + colored ring); terminus = filled (line color);
  //   transfer = white fill + dark ring, larger ("linked" interchange marker)
  const transferRing = theme === 'dark' ? '#e9eef6' : '#1f2630'
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
        ['case', ['==', ['get', 'transfer'], 1], 3.4, ['==', ['get', 'terminus'], 1], 3, 2],
        13,
        ['case', ['==', ['get', 'transfer'], 1], 5.5, ['==', ['get', 'terminus'], 1], 5, 4],
        16,
        ['case', ['==', ['get', 'transfer'], 1], 9, ['==', ['get', 'terminus'], 1], 8, 6.5],
      ],
      // terminus wins over transfer: line ends are filled "black" per official signs
      'circle-color': [
        'case',
        ['==', ['get', 'terminus'], 1],
        ink,
        stationFill,
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'terminus'], 1],
        stationStroke,
        ['==', ['get', 'transfer'], 1],
        transferRing,
        ['get', 'color'],
      ],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', ['==', ['get', 'transfer'], 1], 2, 1.3],
        14,
        ['case', ['==', ['get', 'transfer'], 1], 3, 2.2],
      ],
    },
  })

  // POI markers (airport / coach / YHT) per the official map signs
  map.addLayer({
    id: LAYERS.poi,
    type: 'symbol',
    source: SOURCES.stations,
    minzoom: 10.5,
    filter: ['!=', ['get', 'poi'], ''],
    layout: {
      'icon-image': ['concat', 'poi-', ['get', 'poi']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10.5, 0.45, 13, 0.7, 16, 0.95],
      'icon-allow-overlap': true,
      'icon-offset': [0, -26],
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

  // train bloom — wide soft halo under the dot, giving moving trains a luminous glow
  map.addLayer({
    id: LAYERS.trainsBloom,
    type: 'circle',
    source: SOURCES.trains,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 11, 13, 22, 16, 34],
      'circle-color': ['get', 'color'],
      'circle-blur': 1,
      'circle-opacity': theme === 'dark' ? 0.28 : 0.2,
    },
  })

  // train glow — tighter, brighter inner bloom
  map.addLayer({
    id: LAYERS.trainsGlow,
    type: 'circle',
    source: SOURCES.trains,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 13, 11, 16, 17],
      'circle-color': ['get', 'color'],
      'circle-blur': 0.85,
      'circle-opacity': theme === 'dark' ? 0.6 : 0.5,
    },
  })

  // selected-train soft halo (under the dot) — the "locked on / tracking" glow.
  // Its radius/opacity are pulsed each frame from the animation loop.
  map.addLayer({
    id: LAYERS.trainSelectedHalo,
    type: 'circle',
    source: SOURCES.trainSelected,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 16, 13, 28, 16, 40],
      'circle-color': ['get', 'color'],
      'circle-blur': 0.9,
      'circle-opacity': 0.45,
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

  // direction arrow on every (running) train, rotated to its bearing
  map.addLayer({
    id: LAYERS.trainsArrow,
    type: 'symbol',
    source: SOURCES.trains,
    minzoom: 10,
    filter: ['==', ['get', 'phase'], 'running'],
    layout: {
      'icon-image': 'train-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.28, 14, 0.5, 16.5, 0.7],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // "at a station" pause glyph on every dwelling train (the counterpart to the arrow)
  map.addLayer({
    id: LAYERS.trainsDwell,
    type: 'symbol',
    source: SOURCES.trains,
    minzoom: 10,
    filter: ['==', ['get', 'phase'], 'dwelling'],
    layout: {
      'icon-image': 'train-stop',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.26, 14, 0.46, 16.5, 0.64],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // selected-train crisp ring (on top) — marks the tracked train clearly
  map.addLayer({
    id: LAYERS.trainSelectedRing,
    type: 'circle',
    source: SOURCES.trainSelected,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 11, 16, 15],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': stationFill,
      'circle-stroke-width': 2.6,
    },
  })
}

export function updateTrains(map: maplibregl.Map, snap: NetworkSnapshot) {
  const src = map.getSource(SOURCES.trains) as maplibregl.GeoJSONSource | undefined
  src?.setData(trainsToGeoJSON(snap))
}

function selectedTrainGeoJSON(t: TrainSnapshot | null): FeatureCollection<Point> {
  if (!t) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: t.id, color: lineColorById[t.lineId] ?? '#888', bearing: t.bearing },
        geometry: { type: 'Point', coordinates: t.coord },
      },
    ],
  }
}

/** Set (or clear) the highlighted/tracked train. */
export function updateSelectedTrain(map: maplibregl.Map, t: TrainSnapshot | null) {
  const src = map.getSource(SOURCES.trainSelected) as maplibregl.GeoJSONSource | undefined
  src?.setData(selectedTrainGeoJSON(t))
}

/** Pulse the tracking halo; call each frame from the animation loop with a time in ms. */
export function pulseSelectedTrain(map: maplibregl.Map, nowMs: number) {
  if (!map.getLayer(LAYERS.trainSelectedHalo)) return
  const p = 0.5 + 0.5 * Math.sin(nowMs / 380) // 0..1
  map.setPaintProperty(LAYERS.trainSelectedHalo, 'circle-opacity', 0.22 + 0.32 * p)
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
    map.setPaintProperty(LAYERS.trains, 'circle-opacity', 0.12)
    map.setPaintProperty(LAYERS.trainsGlow, 'circle-opacity', 0.04)
    if (map.getLayer(LAYERS.trainsBloom)) map.setPaintProperty(LAYERS.trainsBloom, 'circle-opacity', 0.02)
    if (map.getLayer(LAYERS.trainsArrow)) map.setPaintProperty(LAYERS.trainsArrow, 'icon-opacity', 0.1)
    if (map.getLayer(LAYERS.trainsDwell)) map.setPaintProperty(LAYERS.trainsDwell, 'icon-opacity', 0.1)
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
  map.setPaintProperty(
    LAYERS.trains,
    'circle-opacity',
    selectedLineId ? ['case', isSel('lineId'), 1, 0.12] : 1,
  )
  map.setPaintProperty(
    LAYERS.trainsGlow,
    'circle-opacity',
    selectedLineId ? ['case', isSel('lineId'), 0.55, 0.04] : 0.5,
  )
  if (map.getLayer(LAYERS.trainsBloom))
    map.setPaintProperty(
      LAYERS.trainsBloom,
      'circle-opacity',
      selectedLineId ? ['case', isSel('lineId'), 0.24, 0.02] : 0.2,
    )
  if (map.getLayer(LAYERS.trainsArrow))
    map.setPaintProperty(
      LAYERS.trainsArrow,
      'icon-opacity',
      selectedLineId ? ['case', isSel('lineId'), 1, 0.1] : 1,
    )
  if (map.getLayer(LAYERS.trainsDwell))
    map.setPaintProperty(
      LAYERS.trainsDwell,
      'icon-opacity',
      selectedLineId ? ['case', isSel('lineId'), 1, 0.1] : 1,
    )
}
