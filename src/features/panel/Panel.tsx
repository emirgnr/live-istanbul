import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
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
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)

  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const isMobile = () => window.matchMedia('(max-width: 879px)').matches

  // The sheet is a constant full-height panel (see panel.css) with the search bar as a
  // fixed header, so when expanded the search always sits at the top — the keyboard can
  // never cover it. We only expose the keyboard height as `--kb` so the scroll area pads
  // its bottom and keeps the last rows reachable above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const apply = () => {
      if (!isMobile()) return root.style.removeProperty('--kb')
      // layout viewport height (clientHeight) is stable across keyboard open/close, unlike
      // window.innerHeight on iOS — so it gives a dependable keyboard height
      const kb = Math.max(0, document.documentElement.clientHeight - vv.height - vv.offsetTop)
      root.style.setProperty('--kb', `${kb > 80 ? Math.round(kb) : 0}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty('--kb')
    }
  }, [])

  // Focusing a field inside the sheet expands it to full height (so the field rises to the
  // top, above the keyboard).
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onFocus = (e: FocusEvent) => {
      if (!isMobile()) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) useAppStore.getState().setSheetExpanded(true)
    }
    el.addEventListener('focusin', onFocus)
    return () => el.removeEventListener('focusin', onFocus)
  }, [])

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
      {/* Search lives OUTSIDE the scroll as a fixed header so the on-screen keyboard's
          scroll-into-view can never push it off-screen (the bug when tapping search from
          the collapsed peek). */}
      {view === 'home' && (
        <div className="search panel__search">
          <Icon name="search" size={18} />
          {isMobile() && !expanded ? (
            // Collapsed on mobile: the field is in the bottom peek. A real input here would
            // make iOS shove the whole fixed panel up to lift it above the keyboard. So we
            // render a BUTTON (it can't open a keyboard): tapping it expands the sheet —
            // the field rises to the top — and only then do we focus the real input, so the
            // keyboard opens with nothing left to push.
            <button
              type="button"
              className={`search__input search__btn${query ? '' : ' search__btn--empty'}`}
              onClick={() => {
                setExpanded(true)
                window.setTimeout(() => searchInputRef.current?.focus(), 400)
              }}
            >
              {query || t('home.search')}
            </button>
          ) : (
            <input
              ref={searchInputRef}
              className="search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setExpanded(true)}
              placeholder={t('home.search')}
              aria-label={t('home.search')}
            />
          )}
          {query && (
            <button
              className="search__clear"
              onClick={() => setQuery('')}
              aria-label={t('nav.clear')}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
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
