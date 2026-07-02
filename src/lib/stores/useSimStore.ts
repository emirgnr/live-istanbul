import { create } from 'zustand'

/**
 * A plain ticking wall-clock (epoch ms). It drives time-of-day service status
 * (which lines are within their operating hours right now) across the header and
 * panel. The moving-vehicle simulation was removed from the geo map — the map now
 * shows only static, verified network data — so nothing here counts trains any
 * more; a lightweight 1s tick in <App> keeps this current.
 */
interface ClockState {
  clockMs: number
  setClock: (ms: number) => void
}

export const useSimStore = create<ClockState>((set) => ({
  clockMs: Date.now(),
  setClock: (clockMs) => set({ clockMs }),
}))
