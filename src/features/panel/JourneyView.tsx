import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { StationPicker } from './StationPicker'
import { DetailHead } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getLine, getStation } from '@/data'
import { planJourneyPoints, type RideLeg } from '@/lib/journey/plan'
import { currentHeadwaySec } from '@/lib/stats'
import { toMinutes } from '@/lib/format'

/**
 * One row per boundary station along the route; each row also carries the segment that LEAVES it
 * (a ride or a walking transfer), so the vertical rail reads as the real trip: coloured line while
 * riding, a dashed hop while transferring. Rebuilt from scratch as a transit timeline — no shared
 * lineage with the old flat leg list.
 */
type Leaving =
  | { kind: 'ride'; leg: RideLeg; color: string }
  | { kind: 'walk'; seconds: number; variant: 'transfer' | 'access' }
  | null
interface Step {
  key: string
  name: string
  leaving: Leaving
  /** boarding a new line at the SAME station (a transfer with no walk) — flagged for a chip. */
  transfer?: boolean
}

function RideBlock({
  leg,
  open,
  onToggle,
}: {
  leg: RideLeg
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const line = getLine(leg.lineId)
  const headway = currentHeadwaySec(leg.lineId, Date.now())
  const mids = leg.stationIds.slice(1, -1)
  return (
    <div className="mil-route__card">
      <div className="mil-route__board">
        {line && <LineBadge line={line} />}
        <span className="mil-route__linename">{line?.name.tr}</span>
      </div>
      <div className="mil-route__cardmeta">
        <span>
          {leg.stops} {t('journey.stops')}
        </span>
        {headway != null && (
          <span>
            · {t('line.headway')} {toMinutes(headway)} {t('units.min')}
          </span>
        )}
        {leg.waitSec > 45 && (
          <span>
            · ~{toMinutes(leg.waitSec)} {t('units.min')} {t('journey.wait')}
          </span>
        )}
      </div>
      {mids.length > 0 && (
        <>
          <button
            className={`mil-route__more${open ? ' is-open' : ''}`}
            onClick={onToggle}
            aria-expanded={open}
          >
            <Icon name="chevron-right" size={14} className="mil-route__chev" />
            {open ? t('journey.hideStations') : t('journey.moreStations', { count: mids.length })}
          </button>
          {open && (
            <ol className="mil-route__mids">
              {mids.map((id) => (
                <li key={id} className="mil-route__mid">
                  <i className="mil-route__middot" />
                  <span>{getStation(id)?.name.tr}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

export function JourneyView() {
  const { t } = useTranslation()
  const from = useAppStore((s) => s.journeyFrom)
  const to = useAppStore((s) => s.journeyTo)
  const setFrom = useAppStore((s) => s.setJourneyFrom)
  const setTo = useAppStore((s) => s.setJourneyTo)
  const swap = useAppStore((s) => s.swapJourney)
  const setJourneyPlan = useAppStore((s) => s.setJourneyPlan)
  const [open, setOpen] = useState<Set<number>>(new Set())

  const plan = useMemo(
    () => (from && to ? planJourneyPoints(from, to, Date.now()) : null),
    [from, to],
  )

  // publish the plan so the map can highlight the traveled route and zoom to it
  useEffect(() => {
    setJourneyPlan(plan)
    return () => setJourneyPlan(null)
  }, [plan, setJourneyPlan])
  // collapse any expanded stop lists when the route changes
  useEffect(() => setOpen(new Set()), [plan])

  const rideLegs = useMemo(
    () => (plan ? plan.legs.filter((l): l is RideLeg => l.type === 'ride') : []),
    [plan],
  )

  // one Step per boundary station; each carries the segment leaving it
  const steps = useMemo<Step[]>(() => {
    if (!plan) return []
    const out: Step[] = []
    const nameOf = (id: string) => getStation(id)?.name.tr ?? id
    const last = () => out[out.length - 1]
    plan.legs.forEach((leg, i) => {
      if (leg.type === 'access') {
        if (leg.dir === 'origin') {
          out.push({ key: `o${i}`, name: from?.label ?? '', leaving: { kind: 'walk', seconds: leg.walkSec, variant: 'access' } })
        } else if (leg.dir === 'dest') {
          const p = last()
          if (p) p.leaving = { kind: 'walk', seconds: leg.walkSec, variant: 'access' }
          out.push({ key: `d${i}`, name: leg.label, leaving: null })
        } else {
          out.push({ key: `o${i}`, name: from?.label ?? '', leaving: { kind: 'walk', seconds: leg.walkSec, variant: 'access' } })
          out.push({ key: `d${i}`, name: leg.label, leaving: null })
        }
        return
      }
      if (leg.type === 'walk') {
        const p = last()
        if (p && p.key === `s${leg.from}`) p.leaving = { kind: 'walk', seconds: leg.walkSec, variant: 'transfer' }
        else out.push({ key: `s${leg.from}`, name: nameOf(leg.from), leaving: { kind: 'walk', seconds: leg.walkSec, variant: 'transfer' } })
        return
      }
      // ride
      const color = getLine(leg.lineId)?.color ?? 'var(--gray-400)'
      const p = last()
      const leaving: Leaving = { kind: 'ride', leg, color }
      if (p && p.key === `s${leg.from}`) {
        // arrived here by a previous ride and now board another line → same-station transfer
        p.leaving = leaving
        p.transfer = true
      } else out.push({ key: `s${leg.from}`, name: nameOf(leg.from), leaving })
      out.push({ key: `s${leg.to}`, name: nameOf(leg.to), leaving: null })
    })
    // de-dup consecutive same-id boundary steps that ended up without a merge
    return out
  }, [plan, from])

  const toggle = (idx: number) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(idx)) n.delete(idx)
      else n.add(idx)
      return n
    })

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

      {from &&
        to &&
        (plan ? (
          <>
            <div className="mil-route__head">
              <div className="mil-route__totals">
                <b>
                  {toMinutes(plan.totalSec)}
                  <em>{t('units.min')}</em>
                </b>
                <span className="mil-route__sub">
                  {plan.transfers > 0
                    ? `${plan.transfers} ${t('journey.transfers')}`
                    : t('journey.direct')}
                </span>
              </div>
              {rideLegs.length > 0 && (
                <div className="mil-route__lines">
                  {rideLegs.map((leg, k) => {
                    const line = getLine(leg.lineId)
                    return (
                      <span className="mil-route__lineitem" key={k}>
                        {k > 0 && (
                          <Icon name="chevron-right" size={13} className="mil-route__lineArrow" />
                        )}
                        {line && <LineBadge line={line} size="sm" />}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            <ol className="mil-route">
              {steps.map((step, si) => {
                const first = si === 0
                const lastStep = si === steps.length - 1
                const lv = step.leaving
                const cls = [
                  'mil-route__step',
                  first && 'mil-route__step--origin',
                  lastStep && 'mil-route__step--dest',
                  lv?.kind === 'ride' && 'mil-route__step--ride',
                  lv?.kind === 'walk' && 'mil-route__step--walk',
                  !lv && 'mil-route__step--last',
                ]
                  .filter(Boolean)
                  .join(' ')
                const style =
                  lv?.kind === 'ride' ? ({ '--seg': lv.color } as CSSProperties) : undefined
                const legIndex = lv?.kind === 'ride' ? plan.legs.indexOf(lv.leg) : -1
                return (
                  <li className={cls} style={style} key={step.key}>
                    <span className="mil-route__gutter">
                      {lv && (
                        <span className="mil-route__dur">
                          {toMinutes(lv.kind === 'ride' ? lv.leg.rideSec : lv.seconds)}{' '}
                          {t('units.min')}
                        </span>
                      )}
                    </span>
                    <span className="mil-route__rail">
                      <i className="mil-route__node" />
                    </span>
                    <span className="mil-route__cell">
                      <span className="mil-route__stophead">
                        <span className="mil-route__stopname">{step.name}</span>
                        {step.transfer && (
                          <span className="mil-route__xfer">
                            <Icon name="transfer" size={11} />
                            {t('journey.transferHere')}
                          </span>
                        )}
                      </span>
                      {lv?.kind === 'ride' && (
                        <RideBlock
                          leg={lv.leg}
                          open={open.has(legIndex)}
                          onToggle={() => toggle(legIndex)}
                        />
                      )}
                      {lv?.kind === 'walk' && (
                        <span className="mil-route__walk">
                          <Icon name="walk" size={15} />
                          {lv.variant === 'transfer' ? t('journey.walkTransfer') : t('journey.walk')}
                        </span>
                      )}
                      {lastStep && <span className="mil-route__arrive">{t('journey.arrive')}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          </>
        ) : (
          <p className="mil-empty">{t('journey.noRoute')}</p>
        ))}
    </div>
  )
}
