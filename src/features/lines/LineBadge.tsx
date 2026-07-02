import type { Line } from '@/lib/network/types'

/** Parse a hex or rgb() color to [r,g,b] (0..255), or null. */
function toRgb(color: string): [number, number, number] | null {
  if (color.startsWith('#')) {
    const c = color.slice(1)
    if (c.length === 3)
      return [parseInt(c[0] + c[0], 16), parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16)]
    if (c.length === 6)
      return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
    return null
  }
  const m = color.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? [+m[1], +m[2], +m[3]] : null
}

/** Relative luminance (WCAG) of a color, 0..1. */
function luminance(color: string): number {
  const rgb = toRgb(color)
  if (!rgb) return 0
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** Pick a legible ink (dark on light lines like M9/M6, white on dark) — a single accessible rule
 *  for every badge on the page, rather than trusting a per-line onColor. */
const inkFor = (color: string): string => (luminance(color) > 0.55 ? '#111827' : '#ffffff')

export function LineBadge({
  line,
  size = 'md',
}: {
  line: Pick<Line, 'code' | 'color' | 'onColor'>
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={`mil-badge mil-badge--${size}`}
      style={{ background: line.color, color: inkFor(line.color) }}
    >
      {line.code}
    </span>
  )
}
