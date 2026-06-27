/** Minutes (rounded, ≥0) from a duration in seconds. */
export const toMinutes = (sec: number): number => Math.max(0, Math.round(sec / 60))

/** "HH:MM" from minutes-since-midnight (wraps past 24h). */
export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const km = (meters: number): string => (meters / 1000).toFixed(1)
