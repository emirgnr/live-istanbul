import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { network } from '@/data'
import './about.css'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mil-modal-scrim" onClick={onClose}>
      <div
        className="mil-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('about.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mil-modal__head">
          <span className="mil-modal__mark">
            <img src={`${import.meta.env.BASE_URL}logos/metro-istanbul.svg`} alt="Metro İstanbul" />
          </span>
          <h2 className="mil-modal__title">{t('about.title')}</h2>
          <button className="mil-modal__close" onClick={onClose} aria-label={t('nav.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="mil-modal__body">
          <p className="mil-modal__note">
            <span className="mil-modal__note-dot" />
            {t('about.estimated')}
          </p>
          <p>{t('about.p1')}</p>
          <p>{t('about.p2')}</p>
          <h3 className="mil-modal__sub">{t('about.sourcesTitle')}</h3>
          <ul className="mil-modal__sources">
            <li>Metro İstanbul Mobile API</li>
            <li>İBB Açık Veri Portalı</li>
            <li>CARTO · OpenStreetMap</li>
          </ul>
          <p className="mil-modal__meta">
            {t('about.dataVersion')} {network.meta.version} ·{' '}
            {t('about.stats', {
              lines: Object.keys(network.lines).length,
              stations: Object.keys(network.stations).length,
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
