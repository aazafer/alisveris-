# Ev Alışveriş Listesi (PWA)

iPhone ve Android için tek bir ortak alışveriş listesi. **Kayıt, Firebase, ödeme veya hesap yok.** Bağlantıyı açan iki kişi aynı listeyi görür; biri yazdığında diğeri anında görür.

Ürün ekleme, **miktar** (boş başlar, içinde silik "miktar" yazar, serbest metin), **öncelik** (**Önemsiz → Normal → Acil**, varsayılan Normal), isteğe bağlı **ürün notu** (✏️+ simgesiyle açılır) ve sayfanın altında iki kişinin ortak kullandığı **ortak not defteri** vardır. Alınan ürünler işaretlenir, istenirse gizlenir veya topluca silinir.

## Nasıl çalışıyor?

- Liste, herkese açık ve ücretsiz bir MQTT broker'da (`wss://broker.hivemq.com:8884/mqtt`) **retained** (saklanan) mesaj olarak tutulur.
- Bağlantıdaki rastgele liste kodu (örn. `EV7K2M9`) konu adıdır: `ev-alisveris/EV7K2M9`. Ortak not ayrı bir konuda saklanır: `ev-alisveris/EV7K2M9/note`.
- Telefon açılınca bu konulara abone olur; broker son listeyi ve son notu hemen gönderir. Bir değişiklik olunca ilgili konu yeniden yayınlanır. Ürün notları ürünün kendisiyle birlikte, ortak not ise ayrı mesaj olarak senkron olur.
- Birleştirme **ürün ürün** yapılır; iki telefon farklı ürün eklediyse ikisi de listede kalır, biri diğerinin ürününü silmez.
- Aynı ürüne iki kişi aynı anda müdahale ederse **daha yeni zaman damgalı** değişiklik kazanır. Zaman damgaları aynı milisaniyeye denk gelirse (çok hızlı eşzamanlı düzenleme) içeriğe göre deterministik bir sıralama kullanılır; böylece iki telefon farklı değerde kalmaz, ikisi de aynı kazananı gösterir. Silme işlemleri de zaman damgalı "tombstone" olarak saklanır, silinen ürün geri gelmez.
- İnternet yokken liste telefonun kendi deposunda durur; bağlantı gelince değişiklikler otomatik eşleşir.

### Açılışta eski liste görünür mü?

Uygulama açılır açılmaz telefonun kendi deposundaki listeyi gösterir (boş ekran beklememek için). Ardından MQTT bağlantısı kurulur ve broker son listeyi gönderir; eşinizin eklediği ürün **genellikle 1 saniye içinde** görünür. Üstteki durum yazısı *Bağlanıyor… → Canlı* olarak değişir; **Canlı** gördüğünüz anda liste günceldir.

Ek önlemler: bağlanınca broker'dan mesaj gelmezse yerel liste 1,5 sn sonra yeniden yayınlanır (broker restart gibi nadir bir durumda veri kaybolmasın diye); ayrıca bağlıyken dakikada bir retained mesaj tazelenir. Uygulama arka planda uyuyup geri geldiğinde MQTT yeniden bağlanır ve listeyi tekrar alır.

> Not: Firebase'in Spark planı da aslında ücretsizdir; burada tamamen kayıtsız ve bağımlılıksız bir çözüm tercih edildi.

## Kurulum (yaklaşık 2 dakika)

1. GitHub'da yeni bir **public** repo oluştur (adı örn. `ev-alisveris`).
2. Bu klasörün (`alisveris`) **içindeki dosyaları** reponun köküne yükle:
   `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`.
   (`README.md` ve `tools/` gerekmez.)
3. Repo → **Settings** → **Pages** → *Build and deployment*: **Source: Deploy from a branch**, dal `main`, klasör `/ (root)` → **Save**.
4. Birkaç dakika sonra adres hazır: `https://KULLANICI_ADIN.github.io/ev-alisveris/`

> İpucu: Mevcut Yılan oyununu da korumak istersen `birds` klasörünün tamamını yükleyebilirsin; adres `https://KULLANICI_ADIN.github.io/<repo>/alisveris/` olur. Uygulama kendi klasöründe çalışır.

## İlk kullanım ve paylaşım

1. Site adresini telefonunda aç. Kurulum ekranı yok; liste hemen açılır ve rastgele bir liste kodu oluşur.
2. Sağ üstteki 🔗 → **Bağlantıyı kopyala** → eşine gönder.
3. Eşin linki açar, aynı listeyi görür. Başka hiçbir ayar yapılmaz.
4. İkiniz de ana ekrana ekleyin:
   - **iPhone (Safari):** Paylaş → **Ana Ekrana Ekle**
   - **Android (Chrome):** ⋮ → **Ana ekrana yükle** (veya ekrandaki *Ana ekrana ekle* butonu)

> iPhone'da ana ekran PWA'sının veri deposu bazı iOS sürümlerinde Safari'den ayrı olabilir. Bu yüzden link her zaman Yanında: gerekirse Safari'de linki bir kez daha açman yeterli; liste kodu bağlantıda olduğu için aynı listeye düşersin.

## Kullanım

- Ürün adını yaz → **Ekle** (Enter da çalışır).
- **Miktar** kutusu boş başlar, içinde silik "miktar" yazar. İstersen `2`, `yarım kg`, `2 demet` gibi bir şey yazarsın; boş bırakabilirsin.
- Öncelik butonları sırayla **Önemsiz / Normal / Acil**; varsayılan **Normal**. Acil ürünün sol kenarı kırmızı olur.
- ✓ ürünü "alındı" işaretler. **Seçenekler → Alınanları gizle** ile gizleyebilir, **Alınanları temizle** ile topluca silebilirsiniz.
- Ürün adına veya miktara dokunup düzenleyebilirsiniz; değişiklik anında eşinize gider.
- **Ürün notu:** Ürünün altındaki ✏️+ simgesine dokunun; not kutusu açılır. Varsayılan olarak kapalıdır, yer kaplamaz. Not yazınca simge maviya döner; tekrar dokununca kapanır, **Notu sil** bağlantısıyla not temizlenir. Örn. "yağsız olsun", "tam buğday".
- **Ortak not:** Sayfanın altındaki 📌 Ortak not alanına yazdığınız her şey eşinizin telefonunda da görünür. Örn. "market yarın kapalı", "kasada ödeme". Yazarken *yazılıyor…*, bırakınca *eşinle paylaşılıyor* yazar.
- **Seçenekler → Yeni liste oluştur** ile tamamen yeni, boş bir liste, yeni bağlantı ve boş bir ortak not açılır.

## Güvenlik ve sınırlar

- Broker herkese açık bir ortak servistir; özel veri için tasarlanmamıştır. Liste konusu rastgele olduğu için bağlantıyı bilmeyenler listeyi bulamaz, ama **bağlantıyı paylaştığın kişiler düzenleyebilir**. Özel/sırlı bilgi yazma.
- Ortak broker'ın servis garantisi yoktur. Kısa bir kesinti olursa liste telefonunda korunur, broker geri gelince senkron devam eder.
- Çok yoğun kullanım (örn. yüzlerce kişi) için uygun değildir; iki kişilik ev kullanımı için fazlasıyla yeterlidir.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Uygulama yüklenemedi" yazıyor | `index.html` dosyasını çift tıklayarak açmışsın. Dosyayı bir web sunucusundan (GitHub Pages veya `python -m http.server`) açmalısın; PWA kurulumu için zaten https gerekir. |
| "Bağlantı yok" yazıyor | İnterneti kontrol et. Ortak broker geçici olarak erişilemez olabilir; liste bu telefonda korunur, birazdan tekrar bağlanır. |
| Eşim listeyi göremiyor | Bağlantıyı tam kopyaladığından (sonundaki `?o=...` dahil) emin ol. |
| Eski ürünler geri geldi | Aynı ürüne iki telefon neredeyse aynı anda müdahale etmiş olabilir; son değişiklik kazanır. Bir kez daha silmen yeterli. |
| Ana ekrana ekleme seçeneği yok | iPhone'da Safari, Android'de Chrome ile açman gerekir. |
| İkon/eski dosyalar görünüyor | Tarayıcı önbelleğini temizle veya sayfayı bir kez yenile (service worker yeni sürümü alır). |

## Dosyalar

| Dosya | İşlev |
|---|---|
| `index.html` | Arayüz, MQTT kütüphanesi, PWA bağlantıları |
| `styles.css` | Mobil tasarım, koyu tema, miktar placeholder stili |
| `app.js` | MQTT senkronu, birleştirme mantığı, liste işlemleri |
| `sw.js` | Service worker — çevrimdışı kabuk |
| `manifest.webmanifest` | PWA tanımı |
| `icon-*.png`, `icon.svg` | Uygulama ikonları |
| `tools/make-icons.js` | İkonları yeniden üretmek için (opsiyonel) |
