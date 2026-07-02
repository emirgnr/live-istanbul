import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapView } from '@/features/map/MapView'
import { SchemeView } from '@/features/scheme/SchemeView'
import { Panel } from '@/features/panel/Panel'
import { AboutDialog } from '@/features/info/AboutDialog'
import { useUiStore } from '@/lib/stores/useUiStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { applyBrandColor } from '@/lib/theme'
import { allLines } from '@/data'
import { isOperating } from '@/lib/stats'
import i18n from '@/i18n'
import './features/shell/header.css'

const BASE = import.meta.env.BASE_URL

/**
 * App shell — a full-bleed live map (geo) or network diagram (scheme) beneath a
 * solid corporate top bar. The bar carries the Metro İstanbul lockup on the left
 * and the operation status + view / language controls on the right. Both map
 * modes share the one info panel (left sidebar on desktop, bottom sheet on phones).
 */
export default function App() {
  const { t } = useTranslation()
  const lang = useUiStore((s) => s.lang)
  const toggleLang = useUiStore((s) => s.toggleLang)
  const mapMode = useUiStore((s) => s.mapMode)
  const setMapMode = useUiStore((s) => s.setMapMode)
  const clockMs = useSimStore((s) => s.clockMs)
  const setClock = useSimStore((s) => s.setClock)
  const clock = new Date(clockMs).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  // "Live" now means the network is within operating hours right now (real service
  // status from the schedule) — not a running simulation.
  const operating = useMemo(() => allLines().some((l) => isOperating(l.id, clockMs)), [clockMs])
  const [aboutOpen, setAboutOpen] = useState(false)

  // Pin the address-bar / PWA brand color once (light theme only).
  useEffect(() => {
    applyBrandColor()
  }, [])

  // A plain 1s wall-clock tick (the moving-train sim that used to drive this is gone).
  useEffect(() => {
    setClock(Date.now())
    const id = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [setClock])

  // Sync language to i18next + <html lang>.
  useEffect(() => {
    void i18n.changeLanguage(lang)
    document.documentElement.lang = lang
  }, [lang])

  const liveLabel = lang === 'tr' ? 'CANLI' : 'LIVE'

  return (
    <>
      {mapMode === 'geo' ? <MapView /> : <SchemeView />}
      {/* One shared info panel for BOTH map modes (left sidebar on desktop, bottom sheet on phones). */}
      <Panel />

      <header className="mil-topbar">
        <div className="mil-topbar__brand">
          <span className="mil-topbar__mark">
            <img src={`${BASE}logos/metro-istanbul.svg`} alt="Metro İstanbul" />
          </span>
          <span className="mil-topbar__word">
            <strong className="mil-topbar__name">{t('app.name')}</strong>
            <span className="mil-topbar__city">{t('app.city')}</span>
          </span>
        </div>

        <div className="mil-topbar__tools">
          <button
            type="button"
            className={`mil-livepill${operating ? ' is-live' : ''}`}
            onClick={() => setAboutOpen(true)}
            title={t('about.title')}
            aria-label={t('about.title')}
          >
            <span className="mil-livepill__dot" aria-hidden />
            <span className="mil-livepill__meta">
              {operating && <em>{liveLabel}</em>}
              <span className="mil-livepill__clock">{clock}</span>
            </span>
          </button>

          <div className="mil-modeseg" role="group" aria-label={t('actions.mapMode')}>
            <button
              type="button"
              className={`mil-modeseg__btn${mapMode === 'geo' ? ' is-active' : ''}`}
              onClick={() => setMapMode('geo')}
              aria-pressed={mapMode === 'geo'}
            >
              {t('actions.viewGeo')}
            </button>
            <button
              type="button"
              className={`mil-modeseg__btn${mapMode === 'scheme' ? ' is-active' : ''}`}
              onClick={() => setMapMode('scheme')}
              aria-pressed={mapMode === 'scheme'}
            >
              {t('actions.viewScheme')}
            </button>
          </div>

          <button
            type="button"
            className="mil-langbtn"
            onClick={toggleLang}
            title={t('actions.language')}
            aria-label={t('actions.language')}
          >
            {lang.toUpperCase()}
          </button>
        </div>
      </header>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </>
  )
}
