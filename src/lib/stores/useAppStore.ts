import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { LineId, StationId } from '@/lib/network/types'
import type { Journey, JourneyPoint } from '@/lib/journey/plan'

export type PanelView = 'home' | 'line' | 'station' | 'journey' | 'train' | 'schedule'

interface AppState {
  view: PanelView
  /** Where a labelled BACK returns to (derived at navigation time, never persisted). */
  parentView: PanelView | null
  parentLineId: LineId | null
  selectedLineId: LineId | null
  selectedStationId: StationId | null
  /**
   * Optional line scoping for the station view. When set (e.g. opened from the relational scheme),
   * the station detail shows ONLY these lines' vehicles/arrivals instead of every line that shares
   * the station record — so "M9 Ataköy" and "B1 Ataköy" read as independent stops. null = show all
   * (the geographic-map behaviour).
   */
  stationLines: LineId[] | null
  /** Id of the train being inspected/tracked (deterministic sim id). */
  selectedTrainId: string | null
  /** Whether the camera locks onto and follows the selected train. */
  followTrain: boolean
  query: string
  /** Mobile bottom-sheet expanded vs peek. */
  sheetExpanded: boolean

  /** Journey planner endpoints + the most recent computed plan (for map highlight). */
  journeyFrom: JourneyPoint | null
  journeyTo: JourneyPoint | null
  journeyPlan: Journey | null
  openJourney: (from?: JourneyPoint | null, to?: JourneyPoint | null) => void
  setJourneyFrom: (p: JourneyPoint | null) => void
  setJourneyTo: (p: JourneyPoint | null) => void
  swapJourney: () => void
  setJourneyPlan: (p: Journey | null) => void

  favorites: { lines: LineId[]; stations: StationId[] }
  recentStations: StationId[]

  openHome: () => void
  openLine: (id: LineId) => void
  openStation: (id: StationId, lines?: LineId[]) => void
  openTrain: (id: string) => void
  setFollowTrain: (v: boolean) => void
  openSchedule: () => void
  setQuery: (q: string) => void
  setSheetExpanded: (v: boolean) => void

  toggleFavLine: (id: LineId) => void
  toggleFavStation: (id: StationId) => void
  isFavLine: (id: LineId) => boolean
  isFavStation: (id: StationId) => boolean
}

const MAX_RECENTS = 12

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: 'home',
      parentView: null,
      parentLineId: null,
      selectedLineId: null,
      selectedStationId: null,
      stationLines: null,
      selectedTrainId: null,
      followTrain: false,
      query: '',
      sheetExpanded: false,
      journeyFrom: null,
      journeyTo: null,
      journeyPlan: null,
      favorites: { lines: [], stations: [] },
      recentStations: [],

      openHome: () =>
        set({
          view: 'home',
          parentView: null,
          parentLineId: null,
          selectedLineId: null,
          selectedStationId: null,
          stationLines: null,
          selectedTrainId: null,
          followTrain: false,
          journeyPlan: null,
        }),

      openJourney: (from, to) =>
        set((s) => ({
          view: 'journey',
          parentView: 'home',
          parentLineId: null,
          sheetExpanded: true,
          selectedLineId: null,
          selectedStationId: null,
          stationLines: null,
          selectedTrainId: null,
          followTrain: false,
          journeyFrom: from !== undefined ? from : s.journeyFrom,
          journeyTo: to !== undefined ? to : s.journeyTo,
        })),
      setJourneyFrom: (journeyFrom) => set({ journeyFrom }),
      setJourneyTo: (journeyTo) => set({ journeyTo }),
      swapJourney: () => set((s) => ({ journeyFrom: s.journeyTo, journeyTo: s.journeyFrom })),
      setJourneyPlan: (journeyPlan) => set({ journeyPlan }),

      openLine: (id) =>
        set({
          view: 'line',
          parentView: 'home',
          parentLineId: null,
          selectedLineId: id,
          selectedStationId: null,
          stationLines: null,
          selectedTrainId: null,
          followTrain: false,
          sheetExpanded: true,
          journeyPlan: null,
        }),

      openStation: (id, lines) =>
        set((s) => ({
          view: 'station',
          // back returns to the parent LINE only when the station was opened scoped to exactly one
          parentView: lines && lines.length === 1 ? 'line' : 'home',
          parentLineId: lines && lines.length === 1 ? lines[0] : null,
          selectedStationId: id,
          stationLines: lines && lines.length ? lines : null,
          selectedTrainId: null,
          followTrain: false,
          sheetExpanded: true,
          journeyPlan: null,
          recentStations: [id, ...s.recentStations.filter((r) => r !== id)].slice(0, MAX_RECENTS),
        })),

      openTrain: (id) =>
        set({
          view: 'train',
          parentView: 'home',
          parentLineId: null,
          selectedTrainId: id,
          followTrain: true,
          selectedLineId: null,
          selectedStationId: null,
          stationLines: null,
          sheetExpanded: false,
          journeyPlan: null,
        }),
      setFollowTrain: (followTrain) => set({ followTrain }),
      openSchedule: () =>
        set({
          view: 'schedule',
          parentView: 'home',
          parentLineId: null,
          sheetExpanded: true,
          selectedLineId: null,
          selectedStationId: null,
          stationLines: null,
          selectedTrainId: null,
          followTrain: false,
          journeyPlan: null,
        }),

      setQuery: (query) => set({ query }),
      setSheetExpanded: (sheetExpanded) => set({ sheetExpanded }),

      toggleFavLine: (id) =>
        set((s) => {
          const has = s.favorites.lines.includes(id)
          return {
            favorites: {
              ...s.favorites,
              lines: has ? s.favorites.lines.filter((l) => l !== id) : [...s.favorites.lines, id],
            },
          }
        }),
      toggleFavStation: (id) =>
        set((s) => {
          const has = s.favorites.stations.includes(id)
          return {
            favorites: {
              ...s.favorites,
              stations: has
                ? s.favorites.stations.filter((l) => l !== id)
                : [...s.favorites.stations, id],
            },
          }
        }),
      isFavLine: (id) => get().favorites.lines.includes(id),
      isFavStation: (id) => get().favorites.stations.includes(id),
    }),
    {
      name: 'mli-app',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ favorites: s.favorites, recentStations: s.recentStations }),
    },
  ),
)
