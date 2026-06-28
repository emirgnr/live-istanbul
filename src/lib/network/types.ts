/**
 * Core domain model for the Istanbul rail network and its train simulation.
 *
 * Design notes
 * ------------
 * - Coordinates are GeoJSON order: [longitude, latitude].
 * - Branching services (e.g. M1A / M1B sharing the Yenikapı–Otogar trunk) are modeled
 *   as separate {@link Line}s, each with a simple ordered station list. Shared track is
 *   represented implicitly by stations/segments appearing in more than one line — this
 *   keeps rendering and simulation straightforward and matches how the official network
 *   map lists them (M1A and M1B are distinct entries).
 * - The simulation is timetable/headway based: given a line's operating window, service
 *   frequency for the current day-type/time-band, and the cumulative run + dwell time
 *   profile, we deterministically compute where every train *should* be at time T.
 *   No persistent vehicle state is required — snapshots are derived each tick.
 */

// ---------------------------------------------------------------------------
// Geometry & identifiers
// ---------------------------------------------------------------------------

/** [longitude, latitude] */
export type LngLat = [number, number]

export type LineId = string // e.g. "M1A", "M2", "MARMARAY", "T1", "F1"
export type StationId = string // stable slug, e.g. "yenikapi", "sishane"
export type SegmentId = string // `${lineId}:${fromIdx}` convention

export type LocalizedText = { tr: string; en: string }

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type LineMode =
  | 'metro' // heavy/light rail rapid transit (M lines)
  | 'marmaray' // commuter rail tunnel (B1)
  | 'suburban' // TCDD suburban (B2)
  | 'tram' // T lines
  | 'funicular' // F lines
  | 'cablecar' // TF lines
  | 'brt' // Metrobüs

export type LineStatus = 'operational' | 'construction' | 'planned'

export interface Line {
  id: LineId
  /** Display code, e.g. "M1A". */
  code: string
  name: LocalizedText
  mode: LineMode
  status: LineStatus
  /** Official line color. */
  color: string
  /** Text color that reads on top of {@link color}. */
  onColor: string
  /**
   * Ordered station ids. Index 0 is the "backward" terminus; the last index is the
   * "forward" terminus. Direction 0 travels 0 → last; direction 1 travels last → 0.
   */
  stations: StationId[]
  /** Year the (first phase of the) line opened, when known. */
  opened?: number
  /** First/last service time as reported by the operator API ("HH:MM"). */
  firstTime?: string
  lastTime?: string
  /** Operator-defined display order in the official line list. */
  order?: number
  /**
   * Hidden service-pattern sub-line: it spawns trains on the map (differentiated by
   * destination) but is not shown as a separate line in lists, search, the map legend or
   * journey routing. E.g. Marmaray's Ataköy–Pendik / Zeytinburnu–Pendik short-turns.
   */
  hidden?: boolean
  /** For a {@link hidden} sub-line, the id of the parent line it belongs to (e.g. "B1"). */
  parent?: LineId
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export type StationFacility =
  | 'wc'
  | 'parking'
  | 'bike'
  | 'atm'
  | 'pharmacy'
  | 'shopping'
  | 'wifi'
  | 'lostfound'

export interface Accessibility {
  /** Step-free access from street to platform. */
  stepFree?: boolean
  elevator?: boolean
  escalator?: boolean
  tactilePaving?: boolean
}

export interface Station {
  id: StationId
  name: LocalizedText
  coord: LngLat
  /** Lines that call at this station. */
  lines: LineId[]
  /** True when more than one line (or another transfer link) serves it. */
  isTransfer: boolean
  accessibility?: Accessibility
  facilities?: StationFacility[]
  /** Nearby stations reachable on foot that serve other lines (walking transfer). */
  transfers?: StationId[]
  /** True when the station is the start/end of any line (filled marker). */
  isTerminus?: boolean
  /** Special point-of-interest marker per the official map. */
  poi?: 'airport' | 'coach' | 'yht'
  /** Raw operator detail (counts/flags) for richer station pages. */
  extra?: {
    escalatorCount?: number
    liftCount?: number
    babyRoom?: boolean
    masjid?: boolean
  }
}

// ---------------------------------------------------------------------------
// Segments (track between adjacent stations on a line)
// ---------------------------------------------------------------------------

export interface Segment {
  id: SegmentId
  lineId: LineId
  /** Index of the originating station within {@link Line.stations}. `to` is `fromIndex + 1`. */
  fromIndex: number
  from: StationId
  to: StationId
  /** Polyline including both endpoints, in travel order (low index → high index). */
  geometry: LngLat[]
  /** Length of the polyline in meters. */
  lengthM: number
  /** Typical in-motion travel time between the two stations, seconds. */
  runTimeS: number
}

// ---------------------------------------------------------------------------
// Schedule / service
// ---------------------------------------------------------------------------

export type ServiceDayType = 'weekday' | 'saturday' | 'sunday'

/**
 * Headway band: within [startMin, endMin) (minutes from local midnight) a train
 * departs each terminus every `headwaySec` seconds.
 */
export interface HeadwayBand {
  startMin: number
  endMin: number
  headwaySec: number
}

export interface LineSchedule {
  lineId: LineId
  /** First departure from a terminus, minutes from midnight. */
  firstDepartureMin: number
  /**
   * Last departure from a terminus, minutes from midnight. May exceed 1440 to express
   * post-midnight service (e.g. 1500 == 01:00 next day).
   */
  lastDepartureMin: number
  /** Headway bands keyed by day type. */
  bands: Record<ServiceDayType, HeadwayBand[]>
  /**
   * Optional per-direction service window ([firstDepMin, lastDepMin]) keyed by direction then
   * day type. When present, that direction's departures are clipped to the window — for
   * asymmetric services like Marmaray's short-turn, where "Pendik treni" (Ataköy→Pendik, dir 0)
   * runs until 21:54 but "Ataköy treni" (Pendik→Ataköy, dir 1) stops at 20:39.
   */
  dirWindow?: Partial<Record<Direction, Partial<Record<ServiceDayType, [number, number]>>>>
  /** Representative dwell time at intermediate stations, seconds (journey-planner fallback). */
  dwellSec: number
  /**
   * Per-station dwell (seconds) aligned to {@link Line.stations} order (direction 0).
   * Termini are 0; transfer hubs dwell longer than standard stops. The engine uses this
   * (scaled by the time-of-day multiplier) for exact, station-specific holds.
   */
  dwellByIdx?: number[]
  /** Layover/turnaround time at each terminus, seconds. */
  terminalLayoverSec: number
  /** Whether the line runs special late-night ("gece metrosu") service on eligible days. */
  nightService?: boolean
  /** Kinematic calibration (reverse-engineered to lock the official one-way time). */
  calibration?: LineCalibration
}

/** Reverse-engineered kinematic parameters that lock the sim to the official timetable. */
export interface LineCalibration {
  /** Ideal cruise (top running) speed, m/s — solved so Σrun+Σdwell = official one-way time. */
  cruiseMps: number
  cruiseKmh: number
  /** Service acceleration / deceleration rates, m/s² (asymmetric). */
  aAcc: number
  aDec: number
  /** Harmonic-mean effective rate, m/s² — total run time depends only on this. */
  aEff: number
  /** Vehicle design speed ceiling, km/h (the V_max cap). */
  vmaxKmh: number
  /** Derived per-stop acceleration penalty, seconds (= cruise/aEff). */
  accelSec: number
  /** Whether the cruise solve hit the V_max ceiling (dwell trimmed to compensate). */
  capped: boolean
  /** Official one-way travel time used as the calibration target, minutes (null if uncalibrated). */
  officialMin: number | null
}

// ---------------------------------------------------------------------------
// Assembled network
// ---------------------------------------------------------------------------

export interface ConstructionLine {
  code: string
  name: string
  geometry: LngLat[]
}

export interface TransferLink {
  a: StationId
  b: StationId
  walkSec: number
  distM: number
}

export interface RailNetwork {
  lines: Record<LineId, Line>
  stations: Record<StationId, Station>
  /** Segments grouped by line, ordered by `fromIndex`. */
  segments: Record<LineId, Segment[]>
  schedules: Record<LineId, LineSchedule>
  /** Per-line precomputed distance/time profile for the simulation. */
  profiles: Record<LineId, LineProfile>
  /** Under-construction lines (geometry only) for a dashed overlay. */
  construction: ConstructionLine[]
  /** Walking transfers between nearby stations on different lines. */
  transfers: TransferLink[]
  /** Metadata about how/when the dataset was built. */
  meta: {
    version: string
    generatedAt: string
    sources: string[]
  }
}

/**
 * Per-line precomputed distance/time profile used by the simulation. Cumulative arrays
 * have `stations.length` entries (cumulative value *at arrival* to each station).
 */
export interface LineProfile {
  lineId: LineId
  /** Cumulative distance along the line at each station, meters. */
  cumDistanceM: number[]
  /** Total line length, meters. */
  totalLengthM: number
  /** Cumulative travel time (run + dwell) from origin to each station, seconds. */
  cumTimeSec: number[]
  /** Full one-way trip time including all intermediate dwells, seconds. */
  oneWayTimeSec: number
}

// ---------------------------------------------------------------------------
// Simulation output
// ---------------------------------------------------------------------------

/** 0 travels stations[0] → stations[last]; 1 travels the reverse. */
export type Direction = 0 | 1

export type TrainPhase = 'running' | 'dwelling' | 'layover'

/** A train's computed state at a given instant. */
export interface TrainSnapshot {
  /** Deterministic id derived from line, direction and dispatch time. */
  id: string
  lineId: LineId
  direction: Direction
  coord: LngLat
  /** Heading in degrees (0 = north, 90 = east). */
  bearing: number
  phase: TrainPhase
  /** Station the train most recently departed (or is dwelling at). */
  fromStation: StationId
  /** Station the train is heading toward. */
  toStation: StationId
  /** Progress 0..1 along the current segment (running phase). */
  segmentProgress: number
  /** Estimated seconds until arrival at {@link toStation}. */
  etaNextSec: number
}

/** Aggregate live state for the whole network at a given instant. */
export interface NetworkSnapshot {
  /** Epoch milliseconds the snapshot represents. */
  t: number
  trains: TrainSnapshot[]
  /** Active train count per line. */
  countByLine: Record<LineId, number>
}
