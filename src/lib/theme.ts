/**
 * Light theme only. There is no dark/system mode — the app is a light "paper"
 * product. This module just pins the address-bar / PWA brand color.
 */
const BRAND_COLOR = '#0b2153' // deep corporate navy (matches the header)

export function applyBrandColor(): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BRAND_COLOR)
}
