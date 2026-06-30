import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapView } from '@/features/map/MapView'
import { SchemeView } from '@/features/scheme/SchemeView'
import { Panel } from '@/features/panel/Panel'
import { AboutDialog } from '@/features/info/AboutDialog'
import { useUiStore } from '@/lib/stores/useUiStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { applyTheme } from '@/lib/theme'
import i18n from '@/i18n'
import './features/shell/header.css'

/**
 * App shell: a full-bleed live map (geo) or network diagram (scheme) with the
 * shared corporate top region floating on top, plus the mode-specific panel.
 *
 * The top region is composed of two free-floating surfaces — a brand lockup on
 * the left and a control toolbar on the right (live operation status, the
 * view / theme / language controls). Each surface carries its own background so
 * it stays legible over the busy map while empty space lets map gestures pass
 * straight through.
 */
export default function App() {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)
  const lang = useUiStore((s) => s.lang)
  const cycleTheme = useUiStore((s) => s.cycleTheme)
  const toggleLang = useUiStore((s) => s.toggleLang)
  const mapMode = useUiStore((s) => s.mapMode)
  const toggleMapMode = useUiStore((s) => s.toggleMapMode)
  const trainCount = useSimStore((s) => s.trainCount)
  const live = useSimStore((s) => s.live)
  const clockMs = useSimStore((s) => s.clockMs)
  const clock = new Date(clockMs).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const [aboutOpen, setAboutOpen] = useState(false)

  // Apply theme, and track OS changes while in "system" mode.
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  // Sync language to i18next + <html lang>.
  useEffect(() => {
    void i18n.changeLanguage(lang)
    document.documentElement.lang = lang
  }, [lang])

  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'
  const liveLabel = lang === 'tr' ? 'CANLI' : 'LIVE'

  return (
    <>
      {mapMode === 'geo' ? <MapView /> : <SchemeView />}
      {mapMode === 'geo' && <Panel />}

      <div className={`mil-top${mapMode === 'scheme' ? ' mil-top--scheme' : ''}`}>
        {/* Brand lockup */}
        <div className="mil-brand">
          <span className="mil-brand__mark">
            <img src={`${import.meta.env.BASE_URL}logos/metro-istanbul.svg`} alt="Metro İstanbul" />
          </span>
          <span className="mil-brand__words">
            <strong className="mil-brand__name">{t('app.name')}</strong>
            <span className="mil-brand__city">{t('app.city')}</span>
          </span>
        </div>

        {/* Control toolbar */}
        <div className="mil-tools">
          {/* Live operation status → opens the "how this works" dialog */}
          <button
            type="button"
            className={`mil-live${live ? ' is-live' : ''}`}
            onClick={() => setAboutOpen(true)}
            aria-label={t('about.title')}
            title={t('about.estimated')}
          >
            <span className="mil-live__pulse" aria-hidden>
              <span className="mil-live__dot" />
            </span>
            <span className="mil-live__readout">
              <span className="mil-live__count">
                <b>{live ? trainCount : '—'}</b>
                <span>{t('app.trains')}</span>
              </span>
              <span className="mil-live__sub">
                {live ? <em>{liveLabel}</em> : null}
                <span className="mil-live__clock">{live ? clock : '··:··'}</span>
              </span>
            </span>
          </button>

          {/* View / theme / language controls */}
          <div className="mil-controls">
            <div className="mil-seg" role="group" aria-label={t('actions.mapMode')}>
              <button
                type="button"
                className={`mil-seg__btn${mapMode === 'geo' ? ' is-active' : ''}`}
                onClick={() => mapMode !== 'geo' && toggleMapMode()}
                aria-pressed={mapMode === 'geo'}
              >
                {t('actions.viewGeo')}
              </button>
              <button
                type="button"
                className={`mil-seg__btn${mapMode === 'scheme' ? ' is-active' : ''}`}
                onClick={() => mapMode !== 'scheme' && toggleMapMode()}
                aria-pressed={mapMode === 'scheme'}
              >
                {t('actions.viewScheme')}
              </button>
            </div>
            {/* scheme mode is always light → the theme toggle is meaningless there */}
            {mapMode === 'geo' && (
              <button
                type="button"
                className="mil-iconbtn"
                onClick={cycleTheme}
                title={`${t('actions.theme')}: ${t(`actions.theme_${theme}`)}`}
                aria-label={t('actions.theme')}
              >
                <span aria-hidden>{themeIcon}</span>
              </button>
            )}
            <button
              type="button"
              className="mil-iconbtn mil-iconbtn--text"
              onClick={toggleLang}
              title={t('actions.language')}
              aria-label={t('actions.language')}
            >
              {lang.toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </>
  )
}
