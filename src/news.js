// Aevum - announcements shown in the "Duyurular" box on the right of the main menu (src/ui/news-ui.js), newest first.
// Turkish here; the English goes into src/i18n/en-misc.js as tr() keys. Only the owner decides what goes here.
// Entry: { id: 'unique-id', date: 'YYYY-MM-DD', title, body, changelog?: '0.9.8' (lists that release's items),
// link?, linkText?, img? }  (body: paragraphs split by a blank line)
export const NEWS = [
  { id: 'n-098', date: '2026-11-25', changelog: '0.9.8', title: 'Oyun sizinle hızla gelişiyor',
    body: 'Sizden gelen @claude önerileriyle oyun çok hızlı gelişiyor. Bu güncellemede birçok yenilik var: deniz savaşları, İngilizce dil desteği ve çok daha fazlası. Tüm değişiklikler için tıklayın. İyi oyunlar!' },
];

export default { NEWS };
