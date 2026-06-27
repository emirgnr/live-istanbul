// Free, reliable CARTO basemaps (vector, light + dark) with attribution.
export const BASEMAP_STYLE = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const

export const ISTANBUL_CENTER: [number, number] = [28.98, 41.04]
export const ISTANBUL_BOUNDS: [[number, number], [number, number]] = [
  [27.9, 40.7],
  [30.1, 41.4],
]

export type BaseTheme = 'light' | 'dark'

// label font shipped with CARTO glyph endpoints
export const LABEL_FONT = ['Open Sans Regular']
export const LABEL_FONT_BOLD = ['Open Sans Bold']
