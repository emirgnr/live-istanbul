export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_COLORS = { light: '#0b2545', dark: '#0a0e14' } as const

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/** Apply the resolved theme to <html data-theme> and the address-bar theme color. */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLORS[resolved])
}
