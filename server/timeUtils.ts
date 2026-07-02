/**
 * timeUtils.ts
 * ------------
 * metro.istanbul AJAXSeferGetir yanıtı KALKIŞ SAATİNİ ("zaman":"22:47") döndürür,
 * kalan dakikayı DEĞİL. Kalan dakika daima Europe/Istanbul duvar saatine (DST dahil)
 * göre hesaplanır — cihaz saatine/yanlış zaman dilimine güvenilmez.
 */

import { config } from './config'

export interface IstanbulParts {
  hour: number
  minute: number
  second: number
  /** dd.mm.yyyy — tarih2 parametresi için */
  dateStr: string
  weekday: string
}

export function istanbulParts(date: Date = new Date()): IstanbulParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value
  return {
    hour: Number(p.hour) % 24, // en-GB gece yarısını '24' verebilir
    minute: Number(p.minute),
    second: Number(p.second),
    dateStr: `${p.day}.${p.month}.${p.year}`,
    weekday: p.weekday,
  }
}

export function istanbulDateStr(date: Date = new Date()): string {
  return istanbulParts(date).dateStr
}

/** "HH:MM" -> gün içi dakika. Geçersizse null. */
export function hhmmToMinutes(hhmm: string): number | null {
  if (typeof hhmm !== 'string') return null
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Bir kalkış saatine ("HH:MM") kaç dakika kaldığını İstanbul saatine göre hesaplar.
 * @param gun API'nin döndürdüğü gün ofseti (0 = bugün)
 * @returns kalan dakika (>= 0) veya saat ayrıştırılamazsa null
 */
export function minutesUntil(
  zaman: string,
  now: Pick<IstanbulParts, 'hour' | 'minute'> = istanbulParts(),
  gun = 0,
): number | null {
  const dep = hhmmToMinutes(zaman)
  if (dep == null) return null
  const nowMin = now.hour * 60 + now.minute
  const g = Number(gun) || 0
  let diff = g * 1440 + dep - nowMin
  // Gece yarısı sarması — SADECE makul olduğunda: gün=0, şu an gece geç saatte (>=20:00)
  // ve kalkış sabahın erken saatinde (<=04:00). Böylece aynı gün içinde az önce geçmiş
  // bir seferi (ör. 09:30 iken şu an 10:00) yanlışlıkla ~1440 dk ileriye ötelemeyiz.
  if (diff < 0 && g === 0 && nowMin >= 20 * 60 && dep <= 4 * 60) {
    diff += 1440
  }
  return Math.max(0, diff)
}
