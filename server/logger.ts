/** logger.ts — Küçük, seviyeli, zaman damgalı log. */

import { config } from './config'

type Level = 'error' | 'warn' | 'info' | 'debug'

const LEVELS: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const active = LEVELS[(config.logLevel as Level)] ?? LEVELS.info

const ts = () => new Date().toISOString()

function make(level: Level) {
  return (...args: unknown[]) => {
    if (LEVELS[level] > active) return
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[${ts()}] ${level.toUpperCase().padEnd(5)}`, ...args)
  }
}

export const log = {
  error: make('error'),
  warn: make('warn'),
  info: make('info'),
  debug: make('debug'),
}
