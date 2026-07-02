# `server/` — Canlı Sefer Backend'i (Proxy / BFF)

Metro Live Istanbul'un **doğal bir parçası** olan, `metro.istanbul`'un `SeferDurumlari`
servisini saran TypeScript backend'i. Frontend'in **Yaklaşan Seferler** ekranını simüle
edilmiş (yanlış) verilerden çıkarıp gerçek, anlık kalan-dakika verisine bağlar.

Ayrı bir proje/paket **değildir**: kök `package.json`'ı, bağımlılıkları ve `tsx` çalışma
zamanını paylaşır.

## Nasıl çalışır (tersine mühendislik, canlı doğrulandı)

| Bileşen | Bulgu | Çözüm |
|---|---|---|
| `ASP.NET_SessionId` | `GET /SeferDurumlari/SeferDetaylari` `Set-Cookie` ile anonim verir | Her tazelemede GET |
| `kod` | CSRF değil — sayfa JS'ine gömülü statik ama **dönen** uygulama anahtarı (`formData.append("kod", '<GUID>')`) | Her GET'te HTML'den regex ile taze kazınır |
| Mapping | 18 hat / ~248 durak / yön + renkler aynı GET sayfasının `<select>`'lerinde gömülü | `mappingParser` ile çıkarılır |
| Yanıt | `POST /SeferDurumlari/AJAXSeferGetir` → JSON `{durum, sefer:[{zaman:"HH:MM", durak2, gun}]}` | JSON parse; `durum:-1` → bağlamı tazele+dene |
| "Kalan dakika" | Yanıt mutlak **saat** verir, dakika değil | `kalan_dakika = kalkış − İstanbul şimdi` (DST + gece-yarısı) |

## Çalıştırma (kökten)

```bash
npm install
npm run dev          # frontend (Vite) + backend (tsx) birlikte
# yalnız backend:
npm run start:api
# seed'i canlıdan yenile:
npm run seed:refresh
# testler:
npm run test:server
METRO_LIVE_TEST=1 npm run test:server
```

## API

- `GET /api/stations/board?line=M3&station=Özgürlük Meydanı` — **durağın tüm yönleri** (frontend bunu kullanır)
- `GET /api/departures?station=251&route=90` — tek yön
- `GET /api/lines` — tüm hatlar (kod, ad, renk, duraklar, yönler); frontend isim köprüsü ve dropdown'lar için
- `GET /health`

Durak/yön hem numerik ID hem de **isimle** çözülebilir; bu yüzden frontend, kendi durak
adı + hat kodunu gönderir ve backend metro.istanbul ID'lerine çözer — **hardcode eşleştirme
tablosu yoktur**.

## Dosya haritası

```
server/
├─ index.ts          # giriş: sunucuyu başlatır, periyodik tazeler, zarif kapanış
├─ app.ts            # Express app + rotalar + rate-limit + hata yönetimi
├─ config.ts         # ayarlar + .env yükleyici + trustProxy
├─ logger.ts         # seviyeli log
├─ timeUtils.ts      # İstanbul saati + kalan_dakika (DST + gece-yarısı)
├─ cache.ts          # TTL cache + single-flight
├─ rateLimiter.ts    # token-bucket (upstream) + sliding-window (API)
├─ mappingParser.ts  # HTML → hat/durak/yön + kod (bağımlılıksız regex)
├─ mappingStore.ts   # depo + id/isim çözümü + doğrulama
├─ metroClient.ts    # session + kod + AJAX çekirdeği (retry'li)
├─ seferService.ts   # çöz → cache → sorgu → kalan-dakika + station board
├─ data/stations.seed.json  # çevrimdışı/soğuk-başlangıç fallback
├─ scripts/refresh-seed.ts
├─ test/smoke.test.ts
└─ tsconfig.json
```

## Dağıtım (deployment)

Frontend GitHub Pages'te **statik** barındırılır ve Node backend'i oraya konamaz. Bu yüzden:

- **Dev:** `npm run dev` ikisini birlikte kaldırır; Vite `/api`'yi backend'e proxy'ler (CORS yok).
- **Prod:** frontend'i GH Pages'e build ederken `VITE_API_BASE_URL`'i ayrı barındırılan
  backend'in URL'ine ayarlayın (herhangi bir Node host: Render/Railway/Fly/VPS). Backend
  erişilemezse frontend zarifçe simülasyona düşer.

> Nazik davranış gömülüdür (10 sn cache + single-flight + upstream token-bucket). Kişisel
> kullanım dışına çıkarsanız metro.istanbul kullanım koşullarını gözden geçirin.
