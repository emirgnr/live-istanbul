# Ürün Vizyonu ve Problem Tanımı

## Mevcut Sorun (Neden Buradayız?)
Uygulamamızın şu anki halinde metroların durağa geliş dakikaları tutarsız ve gerçeği yansıtmıyor. Kullanıcı istasyonda beklerken ekrandaki veriyle tablodaki veri uyuşmuyor. Bu durum ciddi bir UX (Kullanıcı Deneyimi) zafiyeti yaratıyor.

## Çözüm ve Hedef
Elimizde `https://www.metro.istanbul/SeferDurumlari/AJAXSeferGetir` endpoint'ine atılan, form-data içeren ve başarılı sonuç dönen bir cURL komutu var.
Hedefimiz:
1. Bu cURL isteğini baz alarak dinamik bir API servisi veya middle-tier (ara katman) yazmak.
2. Kullanıcı M1A, M1B, M2, M3, M4, M5, M6, M7, M8, M9 hatlarından birini; ardından yönünü; ardından durağını seçtiğinde, net "Dakika" ve "Saat" bilgisini ekrana basmak.

## Kapsam
Sadece gerçek zamanlı veri akışının sağlanması. Mevcut arayüzün iyileştirilmesi veya ekstra özellikler eklenmesi bu fazın dışındadır. Ana odak: **Doğru Veri, Doğru Zaman.**