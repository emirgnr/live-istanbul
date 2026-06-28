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

/**
 * The static Istanbul rail dataset, built from official sources by
 * `scripts/data/build.mjs`. See docs/research for provenance.
 */
export const network = generated as unknown as RailNetwork

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

export const allStations = (): Station[] => Object.values(network.stations)

/** Stations served by a line, in travel order (direction 0). */
export const stationsForLine = (id: LineId): Station[] =>
  (network.lines[id]?.stations ?? []).map((sid) => network.stations[sid]).filter(Boolean)

export const lineIds = (): LineId[] => Object.keys(network.lines)
