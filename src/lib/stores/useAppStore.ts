import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { LineId, StationId } from '@/lib/network/types'

export type PanelView = 'home' | 'line' | 'station'

interface AppState {
  view: PanelView
  selectedLineId: LineId | null
  selectedStationId: StationId | null
  query: string
  /** Mobile bottom-sheet expanded vs peek. */
  sheetExpanded: boolean

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
      favorites: { lines: [], stations: [] },
      recentStations: [],

      openHome: () => set({ view: 'home', selectedLineId: null, selectedStationId: null }),

      openLine: (id) => set({ view: 'line', selectedLineId: id, sheetExpanded: true }),

      openStation: (id) =>
        set((s) => ({
          view: 'station',
          selectedStationId: id,
          sheetExpanded: true,
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
