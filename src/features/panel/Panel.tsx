import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/lib/stores/useAppStore'
import { HomeView } from './HomeView'
import { LineDetailView } from './LineDetailView'
import { StationDetailView } from './StationDetailView'
import { JourneyView } from './JourneyView'
import { TrainDetailView } from './TrainDetailView'
import { ScheduleView } from './ScheduleView'
import './panel.css'

// must match the collapsed peek height in panel.css (.panel transform)
const PEEK_PX = 156
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function Panel() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const expanded = useAppStore((s) => s.sheetExpanded)
  const setExpanded = useAppStore((s) => s.setSheetExpanded)
  const openHome = useAppStore((s) => s.openHome)

  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isMobile = () => window.matchMedia('(max-width: 879px)').matches

  /** Distance (px) the sheet is translated down when collapsed to its peek. */
  function collapsedOffset(): number {
    const el = panelRef.current
    if (!el) return 0
    const safe =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0
    return Math.max(0, el.offsetHeight - (PEEK_PX + safe))
  }

  // Drag-anywhere bottom-sheet gesture. We listen on `window` for the duration of
  // a drag so we keep getting move/up events even when the pointer leaves the small
  // collapsed peek — pointer-capture set after activation would be too late.
  function onPointerDown(e: React.PointerEvent) {
    if (!isMobile()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = panelRef.current
    if (!el) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select')) return // let form controls work

    const scroll = scrollRef.current
    const co = collapsedOffset()
    const d = {
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      active: false,
      collapsedOffset: co,
      startTranslate: expanded ? 0 : co,
      fromScroll: !!scroll && scroll.contains(target),
    }

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - d.startY
      if (!d.active) {
        if (Math.abs(dy) < 6) return
        // gesture began in the scroll body while expanded: only hijack when the
        // content is scrolled to the top and the user pulls down — else let it scroll
        if (d.fromScroll && expanded) {
          const atTop = !scroll || scroll.scrollTop <= 0
          if (!(atTop && dy > 0)) {
            cleanup()
            return
          }
        }
        d.active = true
        el.style.transition = 'none'
      }
      const ty = clamp(d.startTranslate + dy, 0, d.collapsedOffset + 140)
      el.style.transform = `translateY(${ty}px)`
      d.lastY = ev.clientY
      d.lastT = ev.timeStamp
      if (ev.cancelable) ev.preventDefault()
    }

    const up = (ev: PointerEvent) => {
      const wasActive = d.active
      cleanup()
      el.style.transition = ''
      el.style.transform = ''
      if (!wasActive) return

      const dy = ev.clientY - d.startY
      const dt = Math.max(1, ev.timeStamp - d.lastT)
      const vy = (ev.clientY - d.lastY) / dt // px/ms, positive = downward
      const finalTy = clamp(d.startTranslate + dy, 0, d.collapsedOffset + 140)

      // a drag is followed by a synthetic click on the pointerdown target — swallow it
      // once so it can't re-toggle the handle (or activate a button we dragged over)
      const swallow = (ce: Event) => {
        ce.stopPropagation()
        ce.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)

      // drag a detail view down past the collapse point (or fling down) → dismiss home
      const dismissible = view !== 'home' && view !== 'schedule'
      if (dismissible && (finalTy > d.collapsedOffset + 30 || vy > 1.1)) {
        openHome()
        setExpanded(false)
        return
      }
      if (vy < -0.5) setExpanded(true)
      else if (vy > 0.5) setExpanded(false)
      else setExpanded(finalTy < d.collapsedOffset * 0.5)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <aside
      ref={panelRef}
      className={`panel${expanded ? ' panel--expanded' : ''}`}
      onPointerDown={onPointerDown}
    >
      <button
        className="panel__handle"
        onClick={() => setExpanded(!expanded)}
        aria-label={t(expanded ? 'panel.collapse' : 'panel.expand')}
      >
        <span className="panel__grip" />
      </button>
      <div className="panel__scroll" ref={scrollRef}>
        {view === 'home' && <HomeView />}
        {view === 'line' && <LineDetailView />}
        {view === 'station' && <StationDetailView />}
        {view === 'journey' && <JourneyView />}
        {view === 'train' && <TrainDetailView />}
        {view === 'schedule' && <ScheduleView />}
      </div>
    </aside>
  )
}
