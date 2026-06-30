import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { StationPicker } from './StationPicker'
import { DetailHead } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getLine, getStation } from '@/data'
import { planJourneyPoints } from '@/lib/journey/plan'
import { toMinutes } from '@/lib/format'

export function JourneyView() {
  const { t } = useTranslation()
  const from = useAppStore((s) => s.journeyFrom)
  const to = useAppStore((s) => s.journeyTo)
  const setFrom = useAppStore((s) => s.setJourneyFrom)
  const setTo = useAppStore((s) => s.setJourneyTo)
  const swap = useAppStore((s) => s.swapJourney)
  const setJourneyPlan = useAppStore((s) => s.setJourneyPlan)

  const plan = useMemo(
    () => (from && to ? planJourneyPoints(from, to, Date.now()) : null),
    [from, to],
  )

  // publish the plan so the map can highlight the traveled route and zoom to it
  useEffect(() => {
    setJourneyPlan(plan)
    return () => setJourneyPlan(null)
  }, [plan, setJourneyPlan])

  return (
    <div className="mil-view">
      <DetailHead
        leading={
          <span className="mil-dhead__icon">
            <Icon name="transfer" />
          </span>
        }
        title={t('journey.title')}
      />

      <div className="mil-plan">
        <div className="mil-plan__points">
          <StationPicker value={from} onChange={setFrom} placeholder={t('journey.from')} />
          <StationPicker value={to} onChange={setTo} placeholder={t('journey.to')} />
        </div>
        <button
          className="mil-plan__swap"
          onClick={swap}
          aria-label={t('journey.swap')}
          disabled={!from && !to}
        >
          <Icon name="swap" size={18} />
        </button>
      </div>

      {from && to &&
        (plan ? (
          <>
            <div className="mil-jsummary">
              <b>
                {toMinutes(plan.totalSec)} {t('units.min')}
              </b>
              <span>
                {plan.transfers} {t('journey.transfers')}
              </span>
            </div>
            <ol className="mil-legs">
              {plan.legs.map((leg, i) => {
                if (leg.type === 'access') {
                  const stName = leg.stationId ? getStation(leg.stationId)?.name.tr : null
                  const where =
                    leg.dir === 'origin'
                      ? `${leg.label} → ${stName ?? ''}`
                      : leg.dir === 'dest'
                        ? `${stName ?? ''} → ${leg.label}`
                        : leg.label
                  return (
                    <li key={i} className="mil-leg mil-leg--walk">
                      <span className="mil-leg__icon">
                        <Icon name="walk" size={16} />
                      </span>
                      <span className="mil-leg__body">
                        <strong>
                          {t('journey.walk')} · {toMinutes(leg.walkSec)} {t('units.min')}
                        </strong>
                        <small>{where}</small>
                      </span>
                    </li>
                  )
                }
                if (leg.type === 'walk') {
                  return (
                    <li key={i} className="mil-leg mil-leg--walk">
                      <span className="mil-leg__icon">
                        <Icon name="walk" size={16} />
                      </span>
                      <span className="mil-leg__body">
                        <strong>
                          {t('journey.walk')} · {toMinutes(leg.walkSec)} {t('units.min')}
                        </strong>
                        <small>{getStation(leg.to)?.name.tr}</small>
                      </span>
                    </li>
                  )
                }
                const l = getLine(leg.lineId)
                return (
                  <li key={i} className="mil-leg mil-leg--ride">
                    {l ? <LineBadge line={l} /> : null}
                    <span className="mil-leg__body">
                      <strong>
                        {getStation(leg.from)?.name.tr} → {getStation(leg.to)?.name.tr}
                      </strong>
                      <small>
                        {leg.stops} {t('journey.stops')} · {toMinutes(leg.rideSec)} {t('units.min')}
                        {leg.waitSec > 45
                          ? ` · ${t('journey.wait')} ~${toMinutes(leg.waitSec)} ${t('units.min')}`
                          : ''}
                      </small>
                    </span>
                  </li>
                )
              })}
              <li className="mil-leg mil-leg--end">
                <span className="mil-leg__icon mil-leg__icon--end">
                  <Icon name="pin" size={15} />
                </span>
                <span className="mil-leg__body">
                  <strong>{to.label}</strong>
                  <small>{t('journey.arrive')}</small>
                </span>
              </li>
            </ol>
          </>
        ) : (
          <p className="mil-empty">{t('journey.noRoute')}</p>
        ))}
    </div>
  )
}
