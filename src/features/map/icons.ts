import type maplibregl from 'maplibre-gl'

// Simple, recognizable glyphs (24x24 stroke paths) for the official-map POI markers.
const POI_PATHS: Record<string, string> = {
  airport:
    'M21 15.5v-1.6l-7-4.1V4.2a1.5 1.5 0 0 0-3 0v5.6l-7 4.1v1.6l7-2v3.8l-1.9 1.3v1.4L12 20l2.9.7v-1.4L13 18v-3.8z',
  coach:
    'M5 17h14M6.5 5h11a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 14.5v-8A1.5 1.5 0 0 1 6.5 5zM5 10.5h14M8 17.5v1.5M16 17.5v1.5',
  yht:
    'M8.5 4h7A2.5 2.5 0 0 1 18 6.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 13.5v-7A2.5 2.5 0 0 1 8.5 4zM6 10.5h12M9.5 19l-2 2M14.5 19l2 2',
}
const POI_COLOR: Record<string, string> = {
  airport: '#1f5fa8',
  coach: '#6b3fa0',
  yht: '#b3261e',
}

/** Rasterize the POI glyphs and register them with the map (idempotent). */
export function addPoiIcons(map: maplibregl.Map) {
  const S = 46
  for (const [k, d] of Object.entries(POI_PATHS)) {
    const id = `poi-${k}`
    if (map.hasImage(id)) continue
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    // white disc with colored ring
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = POI_COLOR[k]
    ctx.stroke()
    // glyph
    ctx.save()
    const s = (S * 0.6) / 24
    ctx.translate(S / 2 - 12 * s, S / 2 - 12 * s)
    ctx.scale(s, s)
    ctx.strokeStyle = POI_COLOR[k]
    ctx.fillStyle = POI_COLOR[k]
    ctx.lineWidth = 1.9
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke(new Path2D(d))
    ctx.restore()
    map.addImage(id, ctx.getImageData(0, 0, S, S), { pixelRatio: 2 })
  }
}
