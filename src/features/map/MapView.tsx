import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { BASEMAP_STYLE, ISTANBUL_BOUNDS, ISTANBUL_CENTER } from './mapStyle'
import { addNetworkLayers, SOURCES, updateTrains } from './layers'
import { simulate } from '@/lib/simulation/engine'
import { useResolvedTheme } from '@/lib/useResolvedTheme'
import { useSimStore } from '@/lib/stores/useSimStore'

const UPDATE_INTERVAL_MS = 40 // ~25fps train updates
const HUD_INTERVAL_MS = 1000

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const themeRef = useRef<'light' | 'dark'>('light')
  const styleAppliedRef = useRef<'light' | 'dark' | null>(null)
  const resolved = useResolvedTheme()
  themeRef.current = resolved
  const setStats = useSimStore((s) => s.setStats)

  // init the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE[themeRef.current],
      center: ISTANBUL_CENTER,
      zoom: 10.7,
      minZoom: 9,
      maxZoom: 17.5,
      maxBounds: ISTANBUL_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    styleAppliedRef.current = themeRef.current

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'bottom-right',
    )

    // (re)build our layers whenever a style finishes loading (initial + theme swaps)
    const onStyleLoad = () => addNetworkLayers(map, themeRef.current)
    map.on('style.load', onStyleLoad)

    // animation loop: position trains from the live simulation
    let raf = 0
    let lastUpdate = 0
    let lastHud = 0
    const loop = () => {
      const now = Date.now()
      if (now - lastUpdate >= UPDATE_INTERVAL_MS && map.isStyleLoaded() && map.getSource(SOURCES.trains)) {
        lastUpdate = now
        const snap = simulate(now)
        updateTrains(map, snap)
        if (now - lastHud >= HUD_INTERVAL_MS) {
          lastHud = now
          setStats(snap.trains.length, now)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      map.off('style.load', onStyleLoad)
      map.remove()
      mapRef.current = null
    }
  }, [setStats])

  // theme change → swap basemap (style.load handler re-adds our layers)
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleAppliedRef.current === resolved) return
    styleAppliedRef.current = resolved
    map.setStyle(BASEMAP_STYLE[resolved])
  }, [resolved])

  return <div ref={containerRef} className="map-root" />
}
