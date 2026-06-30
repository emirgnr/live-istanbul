import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHead, Section } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { allLines, scheduleForLine } from '@/data'
import { headwayRange } from '@/lib/stats'
import { minutesToHHMM, toMinutes } from '@/lib/format'
import type { LineMode } from '@/lib/network/types'

// official-list display order of the transport modes
const MODE_ORDER: LineMode[] = [
  'metro',
  'marmaray',
  'suburban',
  'tram',
  'funicular',
  'cablecar',
  'brt',
]

export function ScheduleView() {
  const { t } = useTranslation()
  const openLine = useAppStore((s) => s.openLine)

  const lines = allLines()
  const groups = MODE_ORDER.map((mode) => ({
    mode,
    items: lines.filter((l) => l.mode === mode),
  })).filter((g) => g.items.length)

  return (
    <div className="mil-view">
      <DetailHead
        leading={
          <span className="mil-dhead__icon">
            <Icon name="clock" />
          </span>
        }
        title={t('schedule.title')}
        sub={t('schedule.note')}
      />

      {groups.map((g) => (
        <Section title={t(`mode.${g.mode}`)} key={g.mode}>
          <div className="mil-sched">
            {g.items.map((l) => {
              const sch = scheduleForLine(l.id)
              const first = sch ? minutesToHHMM(sch.firstDepartureMin) : l.firstTime ?? '—'
              const last = sch ? minutesToHHMM(sch.lastDepartureMin) : l.lastTime ?? '—'
              const hr = headwayRange(l.id)
              const freq = hr
                ? hr.minSec === hr.maxSec
                  ? `${toMinutes(hr.minSec)}`
                  : `${toMinutes(hr.minSec)}–${toMinutes(hr.maxSec)}`
                : null
              return (
                <button className="mil-sched__row" key={l.id} onClick={() => openLine(l.id)}>
                  <LineBadge line={l} />
                  <span className="mil-sched__main">
                    <span className="mil-sched__name">{l.name.tr}</span>
                    {sch?.nightService && (
                      <span className="mil-sched__night">
                        <Icon name="moon" size={12} /> {t('schedule.night')}
                      </span>
                    )}
                  </span>
                  <span className="mil-sched__times">
                    <span className="mil-sched__hours">
                      {first}–{last}
                    </span>
                    <span className="mil-sched__freq">
                      {freq ? `${t('schedule.every')} ${freq} ${t('units.min')}` : '—'}
                    </span>
                  </span>
                  <Icon name="chevron-right" className="mil-row__chev" size={18} />
                </button>
              )
            })}
          </div>
        </Section>
      ))}
    </div>
  )
}
