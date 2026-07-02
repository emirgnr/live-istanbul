import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { BASEMAP_STYLE, ISTANBUL_BOUNDS, ISTANBUL_CENTER } from './mapStyle'
import {
  addNetworkLayers,
  journeyBounds,
  LAYERS,
  setSelection,
  updateJourney,
} from './layers'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getLine, getStation, segmentsForLine } from '@/data'
import i18n from '@/i18n'
import type { LineId } from '@/lib/network/types'

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

/**
 * The geo map: a static, verified rendering of the Istanbul rail network — lines,
 * stations, interchanges and the planned-journey highlight. The moving-vehicle
 * simulation was removed; this surface now shows only accurate, static data.
 */
export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)

  const selectedLineId = useAppStore((s) => s.selectedLineId)
  const selectedStationId = useAppStore((s) => s.selectedStationId)
  const view = useAppStore((s) => s.view)
  const journeyPlan = useAppStore((s) => s.journeyPlan)

  // init the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE.light,
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
      addNetworkLayers(map, 'light')
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
      // per-line station dot → bridge back to the base station record (refId) scoped to its line
      const f = pickFirst(LAYERS.stations, e)
      const refId = f?.properties?.refId
      const lineId = f?.properties?.lineId
      if (refId) {
        choicePopup?.remove()
        choicePopup = null
        useAppStore.getState().openStation(String(refId), lineId ? [String(lineId)] : undefined)
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
      // M2/M2S overlap Yenikapı→Sanayi Mahallesi → prefer the main line on the trunk
      // (the Seyrantepe spur carries only M2S, so it still opens there)
      if (ids.includes('M2') && ids.includes('M2S')) {
        openLine('M2')
        return
      }
      openLine(ids[0])
    })
    for (const layer of [LAYERS.lines, LAYERS.stations]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    return () => {
      map.off('style.load', onStyleLoad)
      map.remove()
      mapRef.current = null
    }
  }, [])

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
