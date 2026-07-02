import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Lang = 'tr' | 'en'
/** Which base view: the geographic MapLibre map, or the schematic metro diagram. */
export type MapMode = 'geo' | 'scheme'

interface UiState {
  lang: Lang
  mapMode: MapMode
  setLang: (lang: Lang) => void
  toggleLang: () => void
  setMapMode: (mode: MapMode) => void
  toggleMapMode: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lang: 'tr',
      mapMode: 'geo',
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === 'tr' ? 'en' : 'tr' })),
      setMapMode: (mapMode) => set({ mapMode }),
      toggleMapMode: () => set((s) => ({ mapMode: s.mapMode === 'geo' ? 'scheme' : 'geo' })),
    }),
    { name: 'mli-ui' },
  ),
)
