# Şema logoları

Resmî logoları buraya koy; uygulama otomatik kullanır. Dosya yoksa hiçbir şey bozulmaz
(harita üzerindeki logo gizli kalır, Metro İstanbul işareti ise sade "M" işaretine düşer).

Beklenen dosyalar (SVG tercih edilir):

| Dosya                 | Nerede görünür                                  |
| --------------------- | ----------------------------------------------- |
| `metro-istanbul.svg`  | Sol panel başlığı + haritanın sağ-alt köşesi    |
| `marmaray.svg`        | Marmaray hattının üzerinde (harita)             |
| `metrobus.svg`        | Metrobüs hattının üzerinde (harita)             |

Notlar:
- Haritadaki logo konumları `src/features/scheme/MetroMap.tsx` içindeki `LINE_LOGOS`
  dizisinden ayarlanır (x/y = 4800×3450 şema koordinatı, w/h = boyut).
- PNG kullanacaksan uzantıyı `.png` yap ve ilgili `href`/`src` yollarını güncelle (söyle, ben yaparım).
