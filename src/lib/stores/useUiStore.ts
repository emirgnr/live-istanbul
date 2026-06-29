import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeMode } from '@/lib/theme'

export type Lang = 'tr' | 'en'
/** Which base view: the geographic MapLibre map, or the schematic metro diagram. */
export type MapMode = 'geo' | 'scheme'

interface UiState {
  theme: ThemeMode
  lang: Lang
  mapMode: MapMode
  setTheme: (theme: ThemeMode) => void
  cycleTheme: () => void
  setLang: (lang: Lang) => void
  toggleLang: () => void
  toggleMapMode: () => void
}

const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark']

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: 'tr',
      mapMode: 'geo',
      setTheme: (theme) => set({ theme }),
      cycleTheme: () =>
        set((s) => ({
          theme: THEME_ORDER[(THEME_ORDER.indexOf(s.theme) + 1) % THEME_ORDER.length],
        })),
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === 'tr' ? 'en' : 'tr' })),
      toggleMapMode: () => set((s) => ({ mapMode: s.mapMode === 'geo' ? 'scheme' : 'geo' })),
    }),
    { name: 'mli-ui' },
  ),
)
