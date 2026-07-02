# Technical Architecture

## Akış Mimarisi (Data Flow)
İstemci (Mobil/Web) doğrudan Metro İstanbul sunucularına istek ATMAMALIDIR (CORS hataları ve IP bloklanması riski).

**Doğru Akış:**
1. **Client (İstemci):** Sadece "Hat: M3, Durak: 251" bilgisini bizim kendi Backend'imize gönderir.
2. **Bizim Backend (Proxy/BFF Katmanı):**
   * Metro İstanbul anasayfasına veya Sefer Detayları sayfasına bir GET isteği atarak taze bir `ASP.NET_SessionId` ve `kod` (token) alır.
   * Hedef cURL'deki yapıyı kurarak `AJAXSeferGetir` endpoint'ine POST isteği atar.
   * Gelen cevabı (HTML/JSON) parse eder, sadece "Dakika" bilgisini temiz bir JSON objesine çevirir.
   * `{"kalan_dakika": 4, "varis_saati": "14:32"}` formatında Client'a döner.
3. **Caching (Önbellek):** Aynı durak için 10 saniye içinde gelen peş peşe istekler Metro sunucusuna iletilmez, Redis veya in-memory cache'den okunur.

## Beklenen Yapı (TypeScript / Node.js Örneği)
Ekip, bu mimariyi ayağa kaldırmak için bir Proxy Servisi modülü yazmalıdır. `axios` veya `node-fetch` kullanılarak header manipülasyonu yapılacak ve `cheerio` (eğer dönen yanıt HTML ise) kullanılarak dakika verisi scrape edilecektir.