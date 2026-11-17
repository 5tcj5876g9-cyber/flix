import { upsertMany, countAll } from '../src/db.js';

/* بيانات عرض فقط لاختبار الواجهة بدون مفتاح TMDB. ليست أفلام الموقع. */

const DEMO = [
  { tmdb_id: 550, type: 'movie', title: 'Fight Club', original_title: 'Fight Club', year: 1999, rating: 8.4, popularity: 92, language: 'en', countries: 'US', runtime: 139, netflix: false, overview: 'موظف مكتب لا ينام يلتقي بصانع صابون، ويؤسسان نادي قتال سري.' },
  { tmdb_id: 496243, type: 'movie', title: 'Parasite', original_title: '기생충', year: 2019, rating: 8.5, popularity: 180, language: 'ko', countries: 'KR', runtime: 133, netflix: false, overview: 'عائلة فقيرة تتسلل إلى حياة عائلة ثرية، والنتيجة تنقلب رأساً على عقب.' },
  { tmdb_id: 670, type: 'movie', title: 'Oldboy', original_title: '올드보이', year: 2003, rating: 8.3, popularity: 77, language: 'ko', countries: 'KR', runtime: 120, netflix: false, overview: 'رجل محبوس 15 سنة بلا سبب، يخرج لينتقم.' },
  { tmdb_id: 615457, type: 'movie', title: 'Nobody', original_title: 'Nobody', year: 2021, rating: 7.9, popularity: 61, language: 'en', countries: 'US', runtime: 92, netflix: false, overview: 'أب عادي يكشف ماضيه العنيف بعد سرقة بيته.' },
  { tmdb_id: 76341, type: 'movie', title: 'Mad Max: Fury Road', original_title: 'Mad Max: Fury Road', year: 2015, rating: 7.6, popularity: 120, language: 'en', countries: 'AU', runtime: 120, netflix: false, overview: 'مطاردة في صحراء ما بعد الكارثة.' },
  { tmdb_id: 93405, type: 'tv', title: 'Squid Game', original_title: '오징어 게임', year: 2021, rating: 7.8, popularity: 210, language: 'ko', countries: 'KR', runtime: 55, netflix: true, overview: 'ألعاب أطفال قاتلة بجوائز مالية ضخمة.' },
  { tmdb_id: 71446, type: 'tv', title: 'Money Heist', original_title: 'La Casa de Papel', year: 2017, rating: 8.2, popularity: 190, language: 'es', countries: 'ES', runtime: 50, netflix: true, overview: 'عصابة تخطط لسرقة دار الطباعة.' },
  { tmdb_id: 82856, type: 'tv', title: 'The Mandalorian', original_title: 'The Mandalorian', year: 2019, rating: 8.4, popularity: 160, language: 'en', countries: 'US', runtime: 40, netflix: false, overview: 'صياد مكافآت في مجرة بعيدة.' },
  { tmdb_id: 87739, type: 'tv', title: 'Alice in Borderland', original_title: '今際の国のアリス', year: 2020, rating: 8.1, popularity: 140, language: 'ja', countries: 'JP', runtime: 50, netflix: true, overview: 'طوكيو فارغة وألعاب قاتلة تحدد من يعيش.' },
  { tmdb_id: 110316, type: 'tv', title: 'Kingdom', original_title: '킹덤', year: 2019, rating: 8.4, popularity: 130, language: 'ko', countries: 'KR', runtime: 45, netflix: true, overview: 'وباء يحوّل الموتى إلى زومبي في كوريا القديمة.' },
  { tmdb_id: 129, type: 'movie', title: 'Spirited Away', original_title: '千と千尋の神隠し', year: 2001, rating: 8.5, popularity: 150, language: 'ja', countries: 'JP', runtime: 125, netflix: false, overview: 'طفلة تدخل عالم الأرواح.' },
  { tmdb_id: 396535, type: 'movie', title: 'Train to Busan', original_title: '부산행', year: 2016, rating: 7.7, popularity: 110, language: 'ko', countries: 'KR', runtime: 118, netflix: false, overview: 'ركاب قطار يقاومون وباء زومبي.' },
];

const written = upsertMany(DEMO);
console.log(`[seed] ${written} rows · catalog=${countAll()}`);
