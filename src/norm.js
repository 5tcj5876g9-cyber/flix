/*
 * تطبيع النص العربي قبل التخزين وقبل الاستعلام.
 * نفس الدالة على الطرفين، وإلا البحث ما يطابق شي.
 */

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const AR_FOLD = new Map([
  ['\u0623', '\u0627'], // أ
  ['\u0625', '\u0627'], // إ
  ['\u0622', '\u0627'], // آ
  ['\u0671', '\u0627'], // ٱ
  ['\u0649', '\u064A'], // ى
  ['\u0626', '\u064A'], // ئ
  ['\u0624', '\u0648'], // ؤ
  ['\u0629', '\u0647'], // ة
]);

const LATIN_FOLD = new Map([
  ['\u00E0', 'a'], ['\u00E1', 'a'], ['\u00E2', 'a'], ['\u00E4', 'a'], ['\u00E5', 'a'],
  ['\u00E8', 'e'], ['\u00E9', 'e'], ['\u00EA', 'e'], ['\u00EB', 'e'],
  ['\u00EC', 'i'], ['\u00ED', 'i'], ['\u00EE', 'i'], ['\u00EF', 'i'],
  ['\u00F2', 'o'], ['\u00F3', 'o'], ['\u00F4', 'o'], ['\u00F6', 'o'], ['\u00F8', 'o'],
  ['\u00F9', 'u'], ['\u00FA', 'u'], ['\u00FB', 'u'], ['\u00FC', 'u'],
  ['\u00E7', 'c'], ['\u00F1', 'n'], ['\u00DF', 'ss'],
]);

export function normalize(input) {
  if (!input) return '';
  let out = String(input).normalize('NFKC').toLowerCase();
  out = out.replace(TASHKEEL, '').replace(TATWEEL, '');
  out = out.replace(/[\u0623\u0625\u0622\u0671\u0649\u0626\u0624\u0629]/g, (ch) => AR_FOLD.get(ch) ?? ch);
  out = out.replace(/[\u00C0-\u017F]/g, (ch) => LATIN_FOLD.get(ch) ?? ch);
  out = out.replace(NON_WORD, ' ').trim();
  return out;
}

/** يحوّل استعلام المستخدم إلى تعبير FTS5 آمن، كل كلمة بادئة. */
export function toMatch(input) {
  const tokens = normalize(input)
    .split(' ')
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

/** كلمات عنوان الفيلم للمطابقة مع أسماء التورنت. */
export function titleTokens(title, year) {
  const base = normalize(title).split(' ').filter((t) => t.length > 1);
  if (year) base.push(String(year));
  return base;
}
