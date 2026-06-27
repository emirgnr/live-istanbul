import { create } from 'zustand'
import type { LineId } from '@/lib/network/types'

interface SimState {
  /** Total active trains across the network right now. */
  trainCount: number
  /** Active trains per line. */
  countByLine: Record<LineId, number>
  /** Wall-clock the latest snapshot represents (epoch ms). */
  clockMs: number
  /** Whether the simulation loop is producing data. */
  live: boolean
  setStats: (trainCount: number, clockMs: number, countByLine: Record<LineId, number>) => void
}

export const useSimStore = create<SimState>((set) => ({
  trainCount: 0,
  countByLine: {},
  clockMs: Date.now(),
  live: false,
  setStats: (trainCount, clockMs, countByLine) =>
    set({ trainCount, clockMs, countByLine, live: true }),
}))
