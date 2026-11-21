// Aevum - the update log players see in the main menu ("Güncellemeler"), newest first. Add an entry with every
// release (Turkish, player-facing: what changed in the game, not how). Shown by src/ui/updates-ui.js.
export const CHANGELOG = [
  {
    v: '0.9.3', date: '2026-11-22', title: 'Saldırarak yürüme, devriye ve hileye karşı önlemler',
    items: [
      'Yeni komutlar: K ile Saldırarak Yürü (askerler yolda gördükleri düşmanla dövüşüp yollarına devam eder), V ile Devriye (iki nokta arasında gidip gelir). Tuşa bastıktan sonra yere sol tıkla; Shift basılıyken birden çok nokta verebilirsin.',
      'Sağ tıkla gönderilen askerler artık yoldaki düşmana sapmıyor, gittikleri yere varınca dövüşüyor. Yolda dövüşsünler istersen K ile gönder.',
      'Köylüler seçiliyken kendi Oduncu Kampına ya da Maden Ocağına sağ tıklayınca kampa en yakın kaynakta çalışmaya giderler.',
      'Çok oyunculuda hile açıkları kapatıldı: başkası adına komut gönderme, maçı kasten bekletme, sahte lobi ayarları ve TP puanı hileleri.',
      'Katkı: webalet (GitHub). Teşekkürler!',
    ],
  },
  {
    v: '0.9.2', date: '2026-11-21', title: 'Büyücü ve Taş Devri tapınağı',
    items: [
      'Yeni birim Büyücü: Tapınaktan yetişir, çevresindeki dost birlikleri savaşın ortasında da iyileştirir (5 kare, saniyede 2 can). Kendisi saldırmaz; bir birlik aynı anda tek bir büyücüden iyileşir.',
      'Tapınak artık Taş Devrinden kurulabiliyor ve bu çağa özel yeni bir görünümü var.',
      'Tapınağın iyileştirme araştırmaları Büyücüyü de güçlendirir.',
      'Yapay zekâ da ordusu büyüyünce tapınak kurup büyücü yetiştiriyor.',
      'Zafer kuralı değişmedi: tapınak, ayakta kalması gereken binalardan sayılmaz.',
    ],
  },
  {
    v: '0.9.1', date: '2026-11-20', title: 'Büyük binalar, maden sınırı, son çağa kadar teknolojiler ve yeni menü',
    items: [
      'Rakiplerin başlangıç şehir merkezi oyunun ilk saniyesinden haritada ve mini haritada görünüyor; içeride olan biten (birlikleri, çağı, hasarı) sen oraya gidene kadar sisin içinde kalıyor.',
      'Bir maden öbeğinde her oyuncunun en fazla 8 köylüsü çalışabilir; fazlası yakındaki başka bir öbeğe gider. Madene tıklayınca kaç işçinin çalıştığı görünüyor.',
      'Teknolojiler son çağa kadar sürüyor: demirci, üniversite, ahır, kışla, liman, tapınak, kamplar ve diğer binalarda Barut ve Sanayi Çağı için yeni geliştirmeler var. Atlı zırhı geliştirmeleri artık ahırda.',
      'Ağılın kendi geliştirmeleri var (Seçici Islah, Yonca Otlağı, Kış Ağılı, Yem Ambarı, Mandıra); tarla geliştirmeleri artık ağılı etkilemiyor.',
      'Tüfekçi ve piyade tüfekçisinin menzili uzadı: artık düşmanın dibine kadar yürümüyorlar.',
      'Ticaret arabası şimdilik oyundan kaldırıldı.',
      'Görevler kaldırıldı.',
      'Üst çubuk yeni düzende: çağ ilerlemesi çubuğun içinde ikinci satır, kaynak kutuları eşit genişlikte.',
      'Shift + Tab (ya da Shift ile boşta köylü butonu) boştaki tüm köylüleri seçer.',
      'Üretim kuyruğunda Shift ile tıklayınca 5 tanesi birden iptal edilir.',
      'Oyundan çıkarken ve kayıt silerken oyunun kendi onay penceresi açılıyor; tek oyunculuda ana menüye dönerken de soruluyor.',
      'Çok oyunculu maçlarda senkron bozulursa sebebi bulunabilsin diye kayda geçiyor.',
      'Binalar büyük hâlinde ve temelleri onlara göre büyüdü: temel, inşaat iskelesi, seçim karesi ve yerleştirme önizlemesi artık binayla aynı boyda. Yapay zekâ da büyüyen binalara göre yerleşiyor.',
      'Ana menü yeni düzende: hesap kartı (profil, Profil · Çıkış, senkron durumu) sol üstte, menü altında, geri bildirim notu menünün hemen altında.',
      'Çok oyunculu odada harita türü artık resimli kartlarla seçiliyor.',
      'Çevrimiçi Oyuncular listesi uzayınca menüyü taşırmıyor: liste kendi içinde kayıyor.',
      'Yeni zafer kuralı: bir oyuncu, birim üreten bütün binaları (şehir merkezi, kışla, okçuluk alanı, ahır, kuşatma atölyesi, fabrika, liman) yıkılınca yenilir. Kalan askerler ve köylüler maçı uzatmaz; rakibin son 1-2 binası mini haritada yanıp söner.',
      'Güncelleme gelmeden önce herkese geri sayımlı bir uyarı çıkar, çok oyunculu maç kendiliğinden kaydedilir; güncellemeden sonra menüdeki "Kesilen maça devam et" ile kaldığınız yerden sürer.',
      'Farklı sürümdeki oyuncular aynı maça giremez; eski sürümde kalan sekme "Yeni sürüm hazır" uyarısıyla yenilenir.',
      'Oyunun artık bir sekme simgesi var: yer imlerinde ve sekmede şehir merkezi simgesi görünüyor.',
      'Oyun daha hızlı açılıyor: dosyalar tarayıcıda saklanıyor, bina modelleri hızlı bir dağıtım ağından geliyor.',
      'Öğretici mod geldi: Nasıl Oynanır ekranındaki "Öğretici Savaşı Başlat" ile 9 bölümlük bir hikâyede, Bilge Ayaz eşliğinde oyunun temellerini adım adım öğren.',
      'Düzeltme: çağ atlarken üst çubuk artık sola kaymıyor.',
    ],
  },
  {
    v: '0.9', date: '2026-11-20', title: 'Geri bildirim, dizilişler ve daha akıllı yapay zekâ',
    items: [
      'Sohbete @claude yazarak hata ve önerilerini doğrudan geliştiriciye iletebilirsin; "@" yazınca liste açılır, yazarken etiket vurgulanır.',
      'Tek oyunculu oyunda da sohbet açılır (Enter): orada yalnızca @claude geri bildirimleri gider.',
      'Ana menü yeni düzende: solda tek sütun, arkada dönen dünya daha çok görünüyor; her butonun simgesi ve kısa açıklaması var, profil kartı sağ üstte. Menüye "Güncellemeler" ekranı geldi.',
      'Yeni Oyun ekranı yenilendi: her harita türünün küçük bir resmi ve ne tür bir oyun çıkaracağını anlatan açıklaması var, seçim yaparken butonlar artık yer değiştirmiyor.',
      'Oda kodu kalktı: odalara artık sağdaki çevrimiçi oyuncular listesinden davetle girilir.',
      'Çok Oyunculu ekranı ve lobi, çevrimiçi oyuncular listesiyle yan yana tek blok halinde; lobi ayarları düzgün bir tabloda.',
      'Güncellemeler ekranında Geri butonu en üstte ve liste kayarken de görünür.',
      'Askerler için diziliş butonu: Hat, Kare ve V.',
      'Şehir merkezleri yıkılan oyuncunun yenisini kurmak için 2 dakikası var; kurmazsa yenilir ve maç biter.',
      'Maç bitip "Haritayı İzle" dendikten sonra Esc menüsü yeniden açılıyor.',
      'Yürüyen birlikler artık gördükleri her düşmana sapmıyor; yalnızca yollarının üstündekiyle dövüşüp yollarına devam ediyorlar.',
      'Zor yapay zekâ Orta Çağ\'da takılmıyor, Sanayi Çağı\'na kadar ilerliyor.',
      'Yapay zekâ üssünü genişletiyor: daha çok şehir merkezi ve üretim binası kuruyor, binalarını haritaya yayıyor, daha büyük ordular çıkarıyor.',
      'Rakibin bina temeli, işçileri inşaata başlamadan görünmüyor.',
      'Sur parçaları %20 daha hızlı örülüyor.',
    ],
  },
  {
    v: '0.8', date: '2026-11-19', title: 'Çevrimiçi oyuncular',
    items: [
      'Çok Oyunculu ekranında ve lobide sağda çevrimiçi oyuncular listesi: arkadaş olmadan da herkesi tek tek davet edebilirsin.',
      '"Herkesi Davet Et": menüde bekleyen herkese tek tıkla oda daveti (2 dakikada bir).',
      'Oyuncunun ne yaptığı görünür: menüde, tek oyunculu maçta ya da çok oyunculu maçta.',
    ],
  },
  {
    v: '0.7', date: '2026-11-18', title: 'Akıcı görüntü ve yeni kapılar',
    items: [
      'Kare hızı iyileştirmeleri: daha az çizim, bina yerleştirirken ve çağ atlarken takılma yok.',
      'FPS yazısına tıklayınca kare maliyetinin ayrıntıları görünüyor.',
      'Orta Çağ, Barut ve Sanayi çağları için düz, simetrik yeni kapı modelleri; kapılar surlara tam oturuyor.',
      'Oyun açık kaynak oldu (kod AGPL, modeller CC BY-NC-SA).',
    ],
  },
  {
    v: '0.6', date: '2026-11-17', title: 'Her çağa yeni bina modelleri',
    items: [
      'Her çağ için dokulu yeni 3D bina modelleri; surlar, kapılar ve kuleler de modellerden.',
      'Yeni ağaç, buğday tarlası, otlak ve değirmen modelleri.',
      'Haraç ve tutum emirleri çok oyunculuda da çalışıyor; kule ve kale menzili düzeltmeleri.',
    ],
  },
  {
    v: '0.5', date: '2026-11-15', title: 'Tutumlar ve sur savaşları',
    items: [
      'Asker tutumları: Saldırgan, Savunma, Mevzi Koru.',
      'Okçular surlarının arkasında kalıp okları surun üstünden atıyor; yakın dövüşçüler surun içinden vuramıyor.',
      'Çağ atlamak daha pahalı ve uzun, belirli binalar gerekiyor; böğürtlen çalıları 800 yiyecek.',
      '"Keşfedilmiş harita" seçeneği (varsayılan): arazi baştan bilinir, binalar keşfedilince görünür.',
      'Boşluk tuşu + fare ile kamera döndürme; daha hızlı otomatik kayıt.',
      'Surlar, kapılar ve kuleler sığ suya da kurulabiliyor.',
    ],
  },
  {
    v: '0.4', date: '2026-11-14', title: 'Kalabalık ordular ve kapılı surlar',
    items: [
      'Hat dizilişi: yakın dövüşçüler önde, okçular arkada; yürürken savaşma.',
      'Kalabalık birlikler ağaçların arasında takılmadan yürüyor.',
      'Sura kapı açma (3 kare genişliğinde); yapay zekâ kapılı surlar ve köşe kuleleri kuruyor.',
      'Kayıtlı kontrol grupları, toplanma noktası çizgileri, haraç ve takas.',
      'Çiftlik merkezinde değirmen; herkes 20 köylüyle başlıyor.',
      'Shift ile emir sırası, top ve kule dengesi.',
    ],
  },
  {
    v: '0.3', date: '2026-11-13', title: 'Büyük çiftlikler ve iklimler',
    items: [
      'Daha büyük binalar ve haritalar, büyük çiftlikler.',
      'Esc menüsü ve çok oyunculu duraklatma.',
      'Harita iklimleri; temeller düz zemine oturuyor.',
    ],
  },
  {
    v: '0.2', date: '2026-11-12', title: 'Akıcı çok oyunculu',
    items: [
      'Çok oyunculu bağlantı WebSocket ile daha akıcı; çağ atlama ve katılma hataları düzeltildi.',
      'Toplu kuyruk: parası yettiği kadar birlik sıraya alınır.',
      'Çağa göre kule menzili, toplu kuleler, harita işaretleri.',
      'Haritanın ötesinde uzanan doğal manzara.',
    ],
  },
  {
    v: '0.1', date: '2026-11-11', title: 'İlk sürüm',
    items: [
      'Tarayıcıda 3D gerçek zamanlı strateji: Taş Devri\'nden Sanayi Çağı\'na beş çağ.',
      'Çok oyunculu maçlar, kayıt ve kaldığın yerden devam.',
      'Altı harita türü: nehir, kıta, dağlık, ova, iç deniz, adalar.',
      'Google ile giriş, profil, avatar, seviye ve TP; arkadaş listesi ve davetler.',
    ],
  },
];
export const LATEST = CHANGELOG[0].v;
