/**
 * mappingParser.ts
 * ----------------
 * Metro İstanbul "SeferDurumlari/SeferDetaylari" sayfasının HTML'inden hat, durak ve
 * yön (sefer) eşleştirme tablosunu ve gömülü statik "kod"u çıkarır. Dış bağımlılık yok
 * (saf regex), böylece test ve seed üretiminde saf çalıştırılabilir.
 */

export interface MetroRoute {
  routeId: string
  /** "Atatürk Havalimanı-->>Yenikapı" */
  label: string
  from: string | null
  to: string | null
}

export interface MetroStation {
  stationId: string
  name: string
  /** Bu duraktan geçen geçerli yön (route) id'leri. */
  routeIds: string[]
}

export interface MetroLine {
  /** changeTheElements(index) — dahili hat numarası (== seciliHat). */
  index: number
  /** "M1A", "M3", "T1", "TF1"... */
  code: string
  /** "Yenikapı-Atatürk Havalimanı Metro Hattı" */
  name: string
  /** "rgb(150,50,45)" gibi resmî marka rengi. */
  color: string | null
  routes: MetroRoute[]
  stations: MetroStation[]
}

export interface MetroMapping {
  lineCount: number
  lines: MetroLine[]
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function decodeEntities(input: string | null | undefined): string {
  if (input == null) return ''
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, (m) => (m in NAMED_ENTITIES ? NAMED_ENTITIES[m] : m))
    .trim()
}

interface Opt {
  value: string
  text: string
}

function parseOptions(selectHtml: string): Opt[] {
  const out: Opt[] = []
  if (!selectHtml) return out
  const re = /<option\b[^>]*\bvalue="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(selectHtml)) !== null) {
    const value = decodeEntities(m[1])
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ''))
    if (value === '' || /^se[çc]$/i.test(text)) continue // "Seç" placeholder'ı atla
    out.push({ value, text })
  }
  return out
}

function extractSelectBlock(html: string, prefix: string, index: number): string {
  const re = new RegExp(`<select\\b[^>]*\\bid="${prefix}_${index}"[^>]*>([\\s\\S]*?)</select>`, 'i')
  const m = html.match(re)
  return m ? m[1] : ''
}

interface Link {
  seferId: string
  istasyonId: string
  istasyon: string
}

function parseSeferDuraklari(selectHtml: string): Link[] {
  const out: Link[] = []
  if (!selectHtml) return out
  const re = /<option\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(selectHtml)) !== null) {
    const attrs = m[1]
    const seferId = (attrs.match(/data-seferid="([^"]*)"/i) || [])[1]
    const istasyonId = (attrs.match(/data-istasyonid="([^"]*)"/i) || [])[1]
    const istasyon = decodeEntities((attrs.match(/data-istasyon="([^"]*)"/i) || [])[1] || '')
    if (seferId == null || istasyonId == null) continue
    out.push({ seferId, istasyonId, istasyon })
  }
  return out
}

export function parseMapping(html: string): MetroMapping {
  if (typeof html !== 'string' || html.length < 500) {
    throw new Error('parseMapping: HTML gövdesi boş ya da beklenenden kısa.')
  }

  const liRe = /<li\b[^>]*class="[^"]*nav-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  const lines: MetroLine[] = []
  let li: RegExpExecArray | null
  while ((li = liRe.exec(html)) !== null) {
    const block = li[1]

    const idxMatch = block.match(/changeTheElements\((\d+)\)/i)
    if (!idxMatch) continue
    const index = parseInt(idxMatch[1], 10)

    const title = decodeEntities((block.match(/title="([^"]*)"/i) || [])[1] || '')
    const codeMatch = block.match(/<span[^>]*class="lines[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    const code = decodeEntities((codeMatch ? codeMatch[1] : '').replace(/<[^>]+>/g, ''))
    const colorMatch = block.match(/background-color:\s*(rgb\([^)]*\)|#[0-9a-fA-F]{3,8})/i)
    const color = colorMatch ? colorMatch[1].replace(/\s+/g, '') : null

    const routes = parseOptions(extractSelectBlock(block, 'seferler', index))
    const stations = parseOptions(extractSelectBlock(block, 'istasyonlar', index))
    const links = parseSeferDuraklari(extractSelectBlock(block, 'seferduraklari', index))

    const routesByStation = new Map<string, Set<string>>()
    for (const l of links) {
      if (!routesByStation.has(l.istasyonId)) routesByStation.set(l.istasyonId, new Set())
      routesByStation.get(l.istasyonId)!.add(l.seferId)
    }

    const stationsEnriched: MetroStation[] = stations.map((s) => ({
      stationId: s.value,
      name: s.text,
      routeIds: Array.from(routesByStation.get(s.value) || []),
    }))

    const routesEnriched: MetroRoute[] = routes.map((r) => {
      const parts = r.text.split('-->>').map((p) => p.trim())
      return { routeId: r.value, label: r.text, from: parts[0] || null, to: parts[1] || null }
    })

    lines.push({ index, code, name: title, color, routes: routesEnriched, stations: stationsEnriched })
  }

  // Site navbar'ından gelen boş kabuk nav-item'ları (durağı/yönü olmayan) ele.
  const realLines = lines.filter((l) => l.stations.length > 0 || l.routes.length > 0)
  if (realLines.length === 0) {
    throw new Error('parseMapping: hiç hat bulunamadı — sayfa yapısı değişmiş olabilir.')
  }

  realLines.sort((a, b) => a.index - b.index)
  return { lineCount: realLines.length, lines: realLines }
}

/**
 * changeStation() JS'inde gömülü statik "kod" (uygulama anahtarı) GUID'ini çeker.
 *   formData.append("kod", '6b179ecc-...');
 * Bu değer session'a değil, deploy edilen sayfa sürümüne bağlıdır ve döner; bu yüzden
 * her zaman canlı HTML'den taze okunmalıdır.
 */
export function parseKod(html: string): string | null {
  if (typeof html !== 'string') return null
  const patterns = [
    /formData\.append\(\s*["']kod["']\s*,\s*["']([0-9a-fA-F-]{16,})["']\s*\)/i,
    /["']kod["']\s*:\s*["']([0-9a-fA-F-]{16,})["']/i,
    /name=["']kod["'][^>]*value=["']([0-9a-fA-F-]{16,})["']/i,
    /value=["']([0-9a-fA-F-]{16,})["'][^>]*name=["']kod["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}
