import type {
  RailNetwork,
  Line,
  LineId,
  Station,
  StationId,
  Segment,
  LineSchedule,
  LineProfile,
} from '@/lib/network/types'
import generated from './network.generated.json'
import geoGenerated from './geo.generated.json'

/**
 * The static Istanbul rail dataset, built from official sources by
 * `scripts/data/build.mjs`. See docs/research for provenance.
 */
export const network = generated as unknown as RailNetwork

/**
 * The PER-LINE geo dataset that drives the MAP layer (`scripts/data/build-geo.mjs`). Unlike
 * {@link network} (which merges a shared station into one record), here every (line, station)
 * is its own entity so co-located stops of different lines render as SEPARATE points. Panel /
 * arrivals / journey still run on {@link network}; a map dot's `ref_id` bridges back to it.
 */
export interface GeoLine {
  line_id: LineId
  line_name: string
  color: string
  off: number
  geometry: number[][]
}
export interface GeoStation {
  station_id: string
  station_name: string
  line_id: LineId
  coordinates: number[]
  order: number
  ref_id: StationId
  terminus: number
}
export interface GeoTransfer {
  a: string
  b: string
  dist_m: number
}
export const geo = geoGenerated as unknown as {
  meta: Record<string, unknown>
  lines: GeoLine[]
  stations: GeoStation[]
  transfers: GeoTransfer[]
}

export const getLine = (id: LineId): Line | undefined => network.lines[id]
export const getStation = (id: StationId): Station | undefined => network.stations[id]
export const segmentsForLine = (id: LineId): Segment[] => network.segments[id] ?? []
export const scheduleForLine = (id: LineId): LineSchedule | undefined => network.schedules[id]
export const profileForLine = (id: LineId): LineProfile | undefined => network.profiles[id]

/** Lines in the operator's display order (hidden service-pattern sub-lines excluded). */
export const allLines = (): Line[] =>
  Object.values(network.lines)
    .filter((l) => !l.hidden)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

/** Resolve a line id to its user-facing line (a hidden sub-line maps to its parent). */
export const displayLine = (id: LineId): Line | undefined => {
  const l = network.lines[id]
  return l?.parent ? network.lines[l.parent] : l
}

/**
 * A line together with its hidden sub-lines (Marmaray short-turns, Metrobüs routes). The live
 * count / operating status of a parent (especially a {@link Line.shell} like Metrobüs) is the
 * aggregate over this family.
 */
export const familyLineIds = (id: LineId): LineId[] => [
  id,
  ...Object.values(network.lines)
    .filter((l) => l.parent === id)
    .map((l) => l.id),
]

export const allStations = (): Station[] => Object.values(network.stations)

/** Stations served by a line, in travel order (direction 0). */
export const stationsForLine = (id: LineId): Station[] =>
  (network.lines[id]?.stations ?? []).map((sid) => network.stations[sid]).filter(Boolean)

export const lineIds = (): LineId[] => Object.keys(network.lines)
