import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapView } from '@/features/map/MapView'
import { Panel } from '@/features/panel/Panel'
import { AboutDialog } from '@/features/info/AboutDialog'
import { Icon } from '@/components/Icon'
import { useUiStore } from '@/lib/stores/useUiStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { applyTheme } from '@/lib/theme'
import i18n from '@/i18n'

/**
 * App shell. For now: a full-bleed live map with a lightweight branded header
 * carrying working theme + language controls. Real navigation, panels and the
 * simulation HUD land after the research milestone.
 */
export default function App() {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)
  const lang = useUiStore((s) => s.lang)
  const cycleTheme = useUiStore((s) => s.cycleTheme)
  const toggleLang = useUiStore((s) => s.toggleLang)
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

  const themeIcon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🌓'

  return (
    <>
      <MapView />
      <Panel />
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo" aria-hidden>
            M
          </span>
          <div className="app-header__title">
            <strong>{t('app.name')}</strong>
            <span>{t('app.city')}</span>
          </div>
        </div>
        <button
          className="app-header__live"
          onClick={() => setAboutOpen(true)}
          aria-label={t('about.title')}
          title={t('about.estimated')}
        >
          <span className={`live-dot${live ? ' live-dot--on' : ''}`} aria-hidden />
          <span className="app-header__count">
            {live ? trainCount : '—'}
            <em>{t('app.trains')}</em>
          </span>
          <span className="app-header__clock">{live ? clock : '··:··'}</span>
          <Icon name="chevron-right" size={14} className="app-header__live-info" />
        </button>
        <div className="app-header__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={cycleTheme}
            title={`${t('actions.theme')}: ${t(`actions.theme_${theme}`)}`}
            aria-label={t('actions.theme')}
          >
            {themeIcon}
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--text"
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
