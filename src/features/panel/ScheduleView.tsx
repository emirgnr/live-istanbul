import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
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
  const back = useAppStore((s) => s.openHome)
  const openLine = useAppStore((s) => s.openLine)

  const lines = allLines()
  const groups = MODE_ORDER.map((mode) => ({
    mode,
    items: lines.filter((l) => l.mode === mode),
  })).filter((g) => g.items.length)

  return (
    <div className="view">
      <div className="detail-header">
        <button className="icon-button" onClick={back} aria-label={t('nav.back')}>
          <Icon name="arrow-left" />
        </button>
        <div className="detail-header__content">
          <span className="station-pin">
            <Icon name="clock" />
          </span>
          <div className="detail-title">
            <h2>{t('schedule.title')}</h2>
            <span className="detail-sub">{t('schedule.note')}</span>
          </div>
        </div>
      </div>

      {groups.map((g) => (
        <section className="section" key={g.mode}>
          <h3 className="section__title">{t(`mode.${g.mode}`)}</h3>
          <div className="schedule-list">
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
                <button className="schedule-row" key={l.id} onClick={() => openLine(l.id)}>
                  <LineBadge line={l} />
                  <span className="schedule-row__main">
                    <span className="schedule-row__name">{l.name.tr}</span>
                    {sch?.nightService && (
                      <span className="schedule-row__night">
                        <Icon name="moon" size={12} /> {t('schedule.night')}
                      </span>
                    )}
                  </span>
                  <span className="schedule-row__times">
                    <span className="schedule-row__hours">
                      {first}–{last}
                    </span>
                    <span className="schedule-row__freq">
                      {freq ? `${t('schedule.every')} ${freq} ${t('units.min')}` : '—'}
                    </span>
                  </span>
                  <Icon name="chevron-right" className="row__chev" size={18} />
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
