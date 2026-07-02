# API Analizi ve cURL Dekonstrüksiyonu

Elimizdeki örnek cURL (M3 hattı, Özgürlük Meydanı istasyonu, Kayaşehir yönü için):

`ENDPOINT: POST https://www.metro.istanbul/SeferDurumlari/AJAXSeferGetir`

## Parametre Analizi (Form-Data)
* `secim: 1` (Muhtemelen sefer tipini veya sorgu türünü belirtiyor)
* `tarih2: 01.07.2026` (Sorgulanan günün tarihi - Dinamik olmalı)
* `station: 251` (İstasyon ID'si. Örn: 251 = Özgürlük Meydanı. Tüm istasyonların ID map'i çıkarılmalı)
* `route: 90` (Hat/Yön ID'si. Örn: 90 = M3 Kayaşehir yönü. M1-M9 arası tüm ID'ler haritalanmalı)
* `kod: de133273-d506-4191-9b9f-7ce71cdf9b91` **[KRİTİK]** Bu muhtemelen bir CSRF token, session bazlı bir doğrulama kodu veya anlık üretilen bir hash. Sabit bırakılamaz.

## Header ve Cookie Kısıtlamaları
* `ASP.NET_SessionId=p0iwfz5jbegnjuhzdxybrhn1`: Sunucunun oturumu tanıması için gereken cookie.
* `x-requested-with: XMLHttpRequest`: İstek tipini doğrulayan zorunlu header.
* `referer: https://www.metro.istanbul/SeferDurumlari/SeferDetaylari`: Güvenlik duvarını (WAF) aşmak için gerekli referrer header'ı.

## Ekibin Çözmesi Gereken Görevler
1. `kod` parametresinin nereden geldiğini bulmak (Muhtemelen bir önceki GET isteğinin HTML DOM'u içinde hidden input olarak veya bir JavaScript değişkeninde tutuluyor).
2. Tüm Hatlar (M1-M9) ve İstasyonlar için `route` ve `station` ID'lerini içeren bir JSON eşleştirme tablosu (Mapping Table) oluşturmak.
3. Gelen yanıtın (Response) veri tipini (HTML parçası mı yoksa JSON mu?) analiz edip ayrıştıracak (parse edecek) fonksiyonu yazmak.