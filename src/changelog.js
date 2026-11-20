// Aevum - the update log players see in the main menu ("Güncellemeler"), newest first. Add an entry with every
// release (Turkish, player-facing: what changed in the game, not how). Shown by src/ui/updates-ui.js.
export const CHANGELOG = [
  {
    v: '0.9', date: '2026-11-20', title: 'Geri bildirim, dizilişler ve daha akıllı yapay zekâ',
    items: [
      'Sohbete @claude yazarak hata ve önerilerini doğrudan geliştiriciye iletebilirsin; "@" yazınca liste açılır, yazarken etiket vurgulanır.',
      'Tek oyunculu oyunda da sohbet açılır (Enter): orada yalnızca @claude geri bildirimleri gider.',
      'Ana menü yeni düzende: solda tek sütun, arkada dönen dünya daha çok görünüyor; her butonun simgesi ve kısa açıklaması var, profil kartı sağ üstte. Menüye "Güncellemeler" ekranı geldi.',
      'Yeni Oyun ekranı yenilendi: her harita türünün küçük bir resmi ve ne tür bir oyun çıkaracağını anlatan açıklaması var, seçim yaparken butonlar artık yer değiştirmiyor.',
      'Oda kodu kalktı: odalara artık sağdaki çevrimiçi oyuncular listesinden davetle girilir.',
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
