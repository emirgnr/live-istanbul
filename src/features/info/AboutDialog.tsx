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
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('about.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2>{t('about.title')}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('nav.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal__body">
          <p className="est-banner">
            <span className="est-banner__dot" />
            {t('about.estimated')}
          </p>
          <p>{t('about.p1')}</p>
          <p>{t('about.p2')}</p>
          <h3>{t('about.sourcesTitle')}</h3>
          <ul className="modal__sources">
            <li>Metro İstanbul Mobile API</li>
            <li>İBB Açık Veri Portalı</li>
            <li>CARTO · OpenStreetMap</li>
          </ul>
          <p className="modal__meta">
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
