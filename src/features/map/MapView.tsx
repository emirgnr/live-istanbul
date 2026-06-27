import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'

// Free, no-key vector basemap. Will likely be swapped for a custom-styled
// MapLibre style after the design milestone.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

// Istanbul, centered roughly on the Bosphorus.
const ISTANBUL_CENTER: [number, number] = [28.98, 41.04]

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: ISTANBUL_CENTER,
      zoom: 10.5,
      minZoom: 9,
      maxZoom: 18,
      attributionControl: { compact: true },
      // Keep the Bosphorus framing tidy on wide screens.
      maxBounds: [
        [27.9, 40.7],
        [30.1, 41.4],
      ],
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'bottom-right',
    )

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map-root" />
}
