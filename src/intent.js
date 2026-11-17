/*
 * نوايا البحث العربي: كلمة واحدة كثير من الناس تكتبها بدل التصنيف.
 * "كوري" مو اسم فيلم — هي طلب قائمة. نفس الشي للجنس.
 */

const KINDS = new Map([
  ['كوري', 'korean'],
  ['كوريه', 'korean'],
  ['كوريا', 'korean'],
  ['korean', 'korean'],
  ['ياباني', 'asian'],
  ['يابانيه', 'asian'],
  ['انمي', 'asian'],
  ['انيمي', 'asian'],
  ['اسيوي', 'asian'],
  ['اسيوية', 'asian'],
  ['اسيا', 'asian'],
  ['asian', 'asian'],
  ['هندي', 'asian'],
  ['صيني', 'asian'],
  ['تركي', 'asian'],
  ['نتفلكس', 'netflix'],
  ['نتفليكس', 'netflix'],
  ['netflix', 'netflix'],
  ['رائج', 'trending'],
  ['الافضل', 'top_rated'],
  ['افضل', 'top_rated'],
  ['مسلسلات', 'tv_popular'],
  ['مسلسل', 'tv_popular'],
]);

const GENRES = new Map([
  ['رعب', 'Horror'],
  ['horror', 'Horror'],
  ['اكشن', 'Action'],
  ['action', 'Action'],
  ['كوميدي', 'Comedy'],
  ['كوميديا', 'Comedy'],
  ['comedy', 'Comedy'],
  ['دراما', 'Drama'],
  ['drama', 'Drama'],
  ['رومانسي', 'Romance'],
  ['رومانسية', 'Romance'],
  ['romance', 'Romance'],
  ['خيال', 'Sci-Fi'],
  ['science fiction', 'Sci-Fi'],
  ['جريمة', 'Crime'],
  ['crime', 'Crime'],
  ['انيميشن', 'Animation'],
  ['animation', 'Animation'],
  ['وثائقي', 'Documentary'],
  ['documentary', 'Documentary'],
  ['اثارة', 'Thriller'],
  ['thriller', 'Thriller'],
  ['غموض', 'Mystery'],
  ['mystery', 'Mystery'],
  ['حربي', 'War'],
  ['war', 'War'],
  ['غربي', 'Western'],
  ['western', 'Western'],
  ['موسيقي', 'Musical'],
  ['musical', 'Musical'],
  ['فانتازيا', 'Fantasy'],
  ['fantasy', 'Fantasy'],
]);

export function intentFor(rawQuery) {
  const query = String(rawQuery ?? '').trim().toLowerCase();
  if (!query) return null;

  if (KINDS.has(query)) return { kind: KINDS.get(query) };
  if (GENRES.has(query)) return { genre: GENRES.get(query) };

  // "افلام كوري" / "أفلام رعب" — الكلمة الأخيرة هي النية.
  const words = query.split(/\s+/).filter((w) => w.length > 1 && w !== 'افلام' && w !== 'أفلام' && w !== 'فيلم' && w !== 'film' && w !== 'movies');
  if (words.length === 1) {
    if (KINDS.has(words[0])) return { kind: KINDS.get(words[0]) };
    if (GENRES.has(words[0])) return { genre: GENRES.get(words[0]) };
  }
  return null;
}
