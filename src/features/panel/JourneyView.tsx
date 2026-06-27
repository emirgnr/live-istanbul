import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { StationPicker } from './StationPicker'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getLine, getStation } from '@/data'
import { planJourney } from '@/lib/journey/plan'
import { toMinutes } from '@/lib/format'

export function JourneyView() {
  const { t } = useTranslation()
  const back = useAppStore((s) => s.openHome)
  const from = useAppStore((s) => s.journeyFrom)
  const to = useAppStore((s) => s.journeyTo)
  const setFrom = useAppStore((s) => s.setJourneyFrom)
  const setTo = useAppStore((s) => s.setJourneyTo)
  const swap = useAppStore((s) => s.swapJourney)
  const setJourneyPlan = useAppStore((s) => s.setJourneyPlan)

  const plan = useMemo(() => (from && to ? planJourney(from, to, Date.now()) : null), [from, to])

  // publish the plan so the map can highlight the traveled route and zoom to it
  useEffect(() => {
    setJourneyPlan(plan)
    return () => setJourneyPlan(null)
  }, [plan, setJourneyPlan])

  return (
    <div className="view">
      <div className="detail-header">
        <button className="icon-button" onClick={back} aria-label={t('nav.back')}>
          <Icon name="arrow-left" />
        </button>
        <div className="detail-header__content">
          <div className="detail-title">
            <h2>{t('journey.title')}</h2>
          </div>
        </div>
      </div>

      <div className="journey-form">
        <div className="journey-fields">
          <StationPicker value={from} onChange={setFrom} placeholder={t('journey.from')} />
          <StationPicker value={to} onChange={setTo} placeholder={t('journey.to')} />
        </div>
        <button
          className="journey-swap"
          onClick={swap}
          aria-label={t('journey.swap')}
          disabled={!from && !to}
        >
          <Icon name="transfer" size={18} />
        </button>
      </div>

      {from && to &&
        (plan ? (
          <>
            <div className="journey-summary">
              <strong>
                {toMinutes(plan.totalSec)} {t('units.min')}
              </strong>
              <span>
                {plan.transfers} {t('journey.transfers')}
              </span>
            </div>
            <ol className="journey-legs">
              {plan.legs.map((leg, i) =>
                leg.type === 'walk' ? (
                  <li key={i} className="leg leg--walk">
                    <span className="leg__rail" />
                    <span className="leg__icon">
                      <Icon name="pin" size={15} />
                    </span>
                    <span className="leg__body">
                      <strong>
                        {t('journey.walk')} · {toMinutes(leg.walkSec)} {t('units.min')}
                      </strong>
                      <small>{getStation(leg.to)?.name.tr}</small>
                    </span>
                  </li>
                ) : (
                  <li key={i} className="leg leg--ride">
                    {(() => {
                      const l = getLine(leg.lineId)
                      return l ? <LineBadge line={l} /> : null
                    })()}
                    <span className="leg__body">
                      <strong>
                        {getStation(leg.from)?.name.tr} → {getStation(leg.to)?.name.tr}
                      </strong>
                      <small>
                        {leg.stops} {t('journey.stops')} · {toMinutes(leg.rideSec)} {t('units.min')}
                        {leg.waitSec > 45 ? ` · ${t('journey.wait')} ~${toMinutes(leg.waitSec)} ${t('units.min')}` : ''}
                      </small>
                    </span>
                  </li>
                ),
              )}
              <li className="leg leg--end">
                <span className="leg__icon leg__icon--end">
                  <Icon name="pin" size={15} />
                </span>
                <span className="leg__body">
                  <strong>{getStation(to)?.name.tr}</strong>
                  <small>{t('journey.arrive')}</small>
                </span>
              </li>
            </ol>
          </>
        ) : (
          <p className="empty">{t('journey.noRoute')}</p>
        ))}
    </div>
  )
}
