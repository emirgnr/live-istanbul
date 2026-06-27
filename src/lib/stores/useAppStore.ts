import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { LineId, StationId } from '@/lib/network/types'
import type { Journey } from '@/lib/journey/plan'

export type PanelView = 'home' | 'line' | 'station' | 'journey'

interface AppState {
  view: PanelView
  selectedLineId: LineId | null
  selectedStationId: StationId | null
  query: string
  /** Mobile bottom-sheet expanded vs peek. */
  sheetExpanded: boolean

  /** Journey planner endpoints + the most recent computed plan (for map highlight). */
  journeyFrom: StationId | null
  journeyTo: StationId | null
  journeyPlan: Journey | null
  openJourney: (from?: StationId | null, to?: StationId | null) => void
  setJourneyFrom: (id: StationId | null) => void
  setJourneyTo: (id: StationId | null) => void
  swapJourney: () => void
  setJourneyPlan: (p: Journey | null) => void

  favorites: { lines: LineId[]; stations: StationId[] }
  recentStations: StationId[]

  openHome: () => void
  openLine: (id: LineId) => void
  openStation: (id: StationId) => void
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
      selectedLineId: null,
      selectedStationId: null,
      query: '',
      sheetExpanded: false,
      journeyFrom: null,
      journeyTo: null,
      journeyPlan: null,
      favorites: { lines: [], stations: [] },
      recentStations: [],

      openHome: () =>
        set({ view: 'home', selectedLineId: null, selectedStationId: null, journeyPlan: null }),

      openJourney: (from, to) =>
        set((s) => ({
          view: 'journey',
          sheetExpanded: true,
          selectedLineId: null,
          selectedStationId: null,
          journeyFrom: from !== undefined ? from : s.journeyFrom,
          journeyTo: to !== undefined ? to : s.journeyTo,
        })),
      setJourneyFrom: (journeyFrom) => set({ journeyFrom }),
      setJourneyTo: (journeyTo) => set({ journeyTo }),
      swapJourney: () => set((s) => ({ journeyFrom: s.journeyTo, journeyTo: s.journeyFrom })),
      setJourneyPlan: (journeyPlan) => set({ journeyPlan }),

      openLine: (id) =>
        set({ view: 'line', selectedLineId: id, sheetExpanded: true, journeyPlan: null }),

      openStation: (id) =>
        set((s) => ({
          view: 'station',
          selectedStationId: id,
          sheetExpanded: true,
          journeyPlan: null,
          recentStations: [id, ...s.recentStations.filter((r) => r !== id)].slice(0, MAX_RECENTS),
        })),

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
