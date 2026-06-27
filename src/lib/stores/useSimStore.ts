import { create } from 'zustand'

interface SimState {
  /** Total active trains across the network right now. */
  trainCount: number
  /** Wall-clock the latest snapshot represents (epoch ms). */
  clockMs: number
  /** Whether the simulation loop is producing data. */
  live: boolean
  setStats: (trainCount: number, clockMs: number) => void
}

export const useSimStore = create<SimState>((set) => ({
  trainCount: 0,
  clockMs: Date.now(),
  live: false,
  setStats: (trainCount, clockMs) => set({ trainCount, clockMs, live: true }),
}))
