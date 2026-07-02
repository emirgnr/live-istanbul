/**
 * smoke.test.ts — node --import tsx --test ile çalışır.
 *   npm run test:server
 * Canlı uçtan uca için:  METRO_LIVE_TEST=1 npm run test:server
 */

import test from 'node:test'
import assert from 'node:assert'

import { parseMapping, parseKod, decodeEntities } from '../mappingParser'
import { minutesUntil, hhmmToMinutes } from '../timeUtils'
import * as mappingStore from '../mappingStore'

const FIXTURE = `
<ul class="nav choice">
  <li class="nav-item">
    <a title="Bakırköy-Kayaşehir Metro Hattı" onclick="changeTheElements(2);" class="nav-link">
      <span class="lines" style='background-color:rgb(0,168,225);'>M3</span>
    </a>
    <div id="line_2">
      <select id="seferler_2">
        <option value="">Seç</option>
        <option value="90">Bakırköy Sahil--&gt;&gt;Kayaşehir Merkez</option>
        <option value="91">Kayaşehir Merkez--&gt;&gt;Bakırköy Sahil</option>
      </select>
      <select id="istasyonlar_2">
        <option value="">Seç</option>
        <option value="251">&#214;zg&#252;rl&#252;k Meydanı</option>
        <option value="252">Molla G&#252;rani</option>
      </select>
      <select id="seferduraklari_2" style="display:none;">
        <option data-seferid="90" data-istasyonid="251" data-istasyon="&#214;zg&#252;rl&#252;k Meydanı"></option>
        <option data-seferid="91" data-istasyonid="251" data-istasyon="&#214;zg&#252;rl&#252;k Meydanı"></option>
        <option data-seferid="90" data-istasyonid="252" data-istasyon="Molla G&#252;rani"></option>
      </select>
    </div>
  </li>
  <li class="nav-item"><a class="nav-link" href="#">Alakasız menü</a></li>
</ul>
<script>function changeStation(){ formData.append("kod", '6b179ecc-4f2c-4e26-8ea9-5761c40f9736'); }</script>
`

test('parseKod: gömülü statik anahtarı çıkarır', () => {
  assert.strictEqual(parseKod(FIXTURE), '6b179ecc-4f2c-4e26-8ea9-5761c40f9736')
})

test('decodeEntities: sayısal ve isimli entity çözer', () => {
  assert.strictEqual(decodeEntities('&#214;zg&#252;rl&#252;k'), 'Özgürlük')
  assert.strictEqual(decodeEntities('a &amp; b'), 'a & b')
})

test('parseMapping: hat/durak/yön ve renk doğru', () => {
  const m = parseMapping(FIXTURE)
  assert.strictEqual(m.lineCount, 1)
  const line = m.lines[0]
  assert.strictEqual(line.code, 'M3')
  assert.strictEqual(line.color, 'rgb(0,168,225)')
  const st = line.stations.find((s) => s.stationId === '251')!
  assert.strictEqual(st.name, 'Özgürlük Meydanı')
  assert.deepStrictEqual(st.routeIds.sort(), ['90', '91'])
  const r90 = line.routes.find((r) => r.routeId === '90')!
  assert.strictEqual(r90.to, 'Kayaşehir Merkez')
})

test('hhmmToMinutes', () => {
  assert.strictEqual(hhmmToMinutes('22:47'), 22 * 60 + 47)
  assert.strictEqual(hhmmToMinutes('abc'), null)
})

test('minutesUntil: ileri saat', () => {
  assert.strictEqual(minutesUntil('22:47', { hour: 22, minute: 40 }, 0), 7)
})

test('minutesUntil: gece yarısı sarması', () => {
  assert.strictEqual(minutesUntil('00:06', { hour: 23, minute: 58 }, 0), 8)
})

test('minutesUntil: aynı gün geçmiş sefer ~1440 DÖNMEZ', () => {
  assert.strictEqual(minutesUntil('09:30', { hour: 10, minute: 0 }, 0), 0)
})

test('minutesUntil: gün ofseti (gun=1)', () => {
  assert.strictEqual(minutesUntil('00:30', { hour: 23, minute: 0 }, 1), 90)
})

test('mappingStore.resolve/resolveStation: seed ile', () => {
  assert.ok(mappingStore.loadSeed())
  const r = mappingStore.resolve({ station: '251', route: '90' })
  assert.strictEqual(r.station.name, 'Özgürlük Meydanı')
  assert.strictEqual(r.line.code, 'M3')
  const st = mappingStore.resolveStation({ station: '251' })
  assert.ok(st.station.routeIds.length >= 2)
  assert.throws(() => mappingStore.resolve({ station: '251', route: '66' }))
  assert.throws(() => mappingStore.resolveStation({ station: '' as unknown as string }))
})

test('CANLI: getStationBoard gerçek veri', { skip: process.env.METRO_LIVE_TEST !== '1' }, async () => {
  const seferService = await import('../seferService')
  mappingStore.init()
  const board = await seferService.getStationBoard({ line: 'M3', station: '251' })
  assert.strictEqual(board.hatKodu, 'M3')
  assert.ok(board.yonler.length >= 1)
})
