import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { BASEMAP_STYLE, ISTANBUL_BOUNDS, ISTANBUL_CENTER } from './mapStyle'
import { addNetworkLayers, journeyBounds, LAYERS, setSelection, SOURCES, updateJourney, updateTrains } from './layers'
import { simulate } from '@/lib/simulation/engine'
import { useResolvedTheme } from '@/lib/useResolvedTheme'
import { useSimStore } from '@/lib/stores/useSimStore'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getLine, getStation, segmentsForLine } from '@/data'
import i18n from '@/i18n'
import type { LineId } from '@/lib/network/types'

const UPDATE_INTERVAL_MS = 40 // ~25fps train updates
const HUD_INTERVAL_MS = 1000

function lineBounds(lineId: LineId): maplibregl.LngLatBoundsLike | null {
  const segs = segmentsForLine(lineId)
  if (!segs.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of segs)
    for (const [x, y] of s.geometry) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const themeRef = useRef<'light' | 'dark'>('light')
  const styleAppliedRef = useRef<'light' | 'dark' | null>(null)
  const readyRef = useRef(false)
  const resolved = useResolvedTheme()
  themeRef.current = resolved
  const setStats = useSimStore((s) => s.setStats)

  const selectedLineId = useAppStore((s) => s.selectedLineId)
  const selectedStationId = useAppStore((s) => s.selectedStationId)
  const view = useAppStore((s) => s.view)
  const journeyPlan = useAppStore((s) => s.journeyPlan)

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
    if (import.meta.env.DEV) {
      ;(window as unknown as { __map?: maplibregl.Map }).__map = map
      ;(window as unknown as { __store?: typeof useAppStore }).__store = useAppStore
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'bottom-right',
    )

    const onStyleLoad = () => {
      addNetworkLayers(map, themeRef.current)
      setSelection(map, useAppStore.getState().selectedLineId)
      updateJourney(map, useAppStore.getState().journeyPlan)
      readyRef.current = true
    }
    map.on('style.load', onStyleLoad)

    // interactions
    const pickFirst = (layer: string, e: maplibregl.MapMouseEvent) =>
      map.queryRenderedFeatures(e.point, { layers: [layer] })[0]

    // line-choice popup (for shared trunks where one click could mean two lines, e.g.
    // M1A/M1B between Yenikapı and Otogar)
    let choicePopup: maplibregl.Popup | null = null
    const openLine = (id: string) => {
      choicePopup?.remove()
      choicePopup = null
      useAppStore.getState().openLine(id)
    }
    const showLineChoice = (lngLat: maplibregl.LngLat, ids: string[]) => {
      choicePopup?.remove()
      const el = document.createElement('div')
      el.className = 'line-choice'
      const title = document.createElement('div')
      title.className = 'line-choice__title'
      title.textContent = i18n.t('map.chooseLine')
      el.appendChild(title)
      for (const id of ids) {
        const l = getLine(id)
        if (!l) continue
        const btn = document.createElement('button')
        btn.className = 'line-choice__btn'
        btn.innerHTML =
          `<span class="line-choice__badge" style="background:${l.color};color:${l.onColor}">${l.code}</span>` +
          `<span class="line-choice__name">${l.name.tr}</span>`
        btn.onclick = () => openLine(id)
        el.appendChild(btn)
      }
      choicePopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: '300px', className: 'line-choice-popup' })
        .setLngLat(lngLat)
        .setDOMContent(el)
        .addTo(map)
    }

    map.on('click', LAYERS.stations, (e) => {
      const f = pickFirst(LAYERS.stations, e)
      const id = f?.properties?.id
      if (id) {
        choicePopup?.remove()
        choicePopup = null
        useAppStore.getState().openStation(String(id))
      }
    })
    map.on('click', LAYERS.lines, (e) => {
      // ignore if a station was also under the cursor (handled above)
      if (map.queryRenderedFeatures(e.point, { layers: [LAYERS.stations] }).length) return
      const ids = [
        ...new Set(
          map
            .queryRenderedFeatures(e.point, { layers: [LAYERS.lines] })
            .map((f) => String(f.properties?.id))
            .filter(Boolean),
        ),
      ]
      if (!ids.length) return
      // shared trunk: M1A and M1B overlap Yenikapı→Otogar → let the user choose
      if (ids.includes('M1A') && ids.includes('M1B')) {
        showLineChoice(e.lngLat, ['M1A', 'M1B'])
        return
      }
      openLine(ids[0])
    })
    for (const layer of [LAYERS.lines, LAYERS.stations, LAYERS.trains]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    // animation loop
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
          setStats(snap.trains.length, now, snap.countByLine)
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

  // theme change → swap basemap (style.load handler re-adds our layers + selection)
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleAppliedRef.current === resolved) return
    styleAppliedRef.current = resolved
    readyRef.current = false
    map.setStyle(BASEMAP_STYLE[resolved])
  }, [resolved])

  // selection highlight
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    setSelection(map, selectedLineId)
  }, [selectedLineId])

  // planned-route highlight: draw only the traveled portion, dim the rest, zoom to it
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    updateJourney(map, journeyPlan)
    if (journeyPlan) {
      const b = journeyBounds(journeyPlan)
      if (b) map.fitBounds(b, { padding: { top: 90, bottom: 80, left: 56, right: 56 }, duration: 800, maxZoom: 15 })
    } else {
      setSelection(map, selectedLineId)
    }
  }, [journeyPlan, selectedLineId])

  // focus the map on the current selection
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (view === 'station' && selectedStationId) {
      const st = getStation(selectedStationId)
      if (st) map.easeTo({ center: st.coord, zoom: Math.max(map.getZoom(), 13.5), duration: 700 })
    } else if (view === 'line' && selectedLineId) {
      const b = lineBounds(selectedLineId)
      if (b) map.fitBounds(b, { padding: { top: 90, bottom: 80, left: 60, right: 60 }, duration: 800 })
    }
  }, [view, selectedLineId, selectedStationId])

  return <div ref={containerRef} className="map-root" />
}
