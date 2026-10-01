// places.js — where a match is, how far it is from home, and how to get there.
//
// An assignment names a stadium («ملعب مدينة الأمير عبدالله بن جلوي بالأحساء»)
// and two clubs. locate() reads the city from the stadium's name, else from a
// known stadium, else from the home club, whose ground the match is played on.
// travelFor() turns that into the match's travel: no trip under 40 km, a drive up
// to 300 km on the road, a flight beyond (the referee's own rule).
//
// Pure ESM like matchplan.js: Today's match form calls it directly, and the
// server's /api/place imports it, then refines the distance with a real road
// route and geocodes a stadium no table here knows (server.js).
//
// Coordinates are city centres, enough for distances in tens of kilometres.

export const HOME = { name: 'الزلفي', lat: 26.2994, lon: 44.8154 };
export const HOME_AIRPORT = 'الرياض';           // the referee always flies from King Khalid, Riyadh
export const LOCAL_KM = 40, FLY_KM = 300;
const ROAD = 1.15;                         // road distance over straight-line, when no route is known

// city -> [lat, lon]; extra spellings point at the same entry
const C = {
  'الرياض': [24.7136, 46.6753], 'جدة': [21.5433, 39.1728], 'مكة': [21.3891, 39.8579], 'المدينة': [24.5247, 39.5692],
  'الدمام': [26.4207, 50.0888], 'الخبر': [26.2172, 50.1971], 'الظهران': [26.2361, 50.0393], 'القطيف': [26.5196, 50.0115],
  'سيهات': [26.4833, 50.0333], 'صفوى': [26.6497, 49.9564], 'الجبيل': [27.0174, 49.6225], 'الأحساء': [25.3833, 49.5864],
  'المبرز': [25.4077, 49.5903], 'بريدة': [26.3260, 43.9750], 'عنيزة': [26.0840, 43.9930], 'الرس': [25.8694, 43.4973],
  'البكيرية': [26.1393, 43.6578], 'المذنب': [25.8601, 44.2223], 'البدائع': [25.9894, 43.7339], 'الزلفي': [26.2994, 44.8154],
  'المجمعة': [25.9038, 45.3456], 'حرمة': [25.9333, 45.3333], 'الغاط': [26.0270, 44.9622], 'شقراء': [25.2483, 45.2522],
  'الدوادمي': [24.5077, 44.3924], 'عفيف': [23.9065, 42.9172], 'الخرج': [24.1556, 47.3120], 'الدرعية': [24.7340, 46.5750],
  'المزاحمية': [24.4720, 46.2700], 'حائل': [27.5114, 41.7208], 'تبوك': [28.3835, 36.5662], 'أبها': [18.2164, 42.5053],
  'خميس مشيط': [18.3000, 42.7333], 'جازان': [16.8892, 42.5511], 'صبيا': [17.1495, 42.6254], 'نجران': [17.4924, 44.1277],
  'الباحة': [20.0129, 41.4677], 'بيشة': [20.0005, 42.6052], 'الطائف': [21.2703, 40.4158], 'ينبع': [24.0890, 38.0637],
  'رابغ': [22.7986, 39.0349], 'القنفذة': [19.1281, 41.0787], 'محايل': [18.5460, 42.0470], 'عرعر': [30.9753, 41.0381],
  'سكاكا': [29.9697, 40.2064], 'دومة الجندل': [29.8117, 39.8681], 'القريات': [31.3317, 37.3428], 'طريف': [31.6725, 38.6637],
  'رفحاء': [29.6266, 43.4932], 'حفر الباطن': [28.4328, 45.9708], 'الخفجي': [28.4391, 48.4913], 'النعيرية': [27.4706, 48.4880],
  'وادي الدواسر': [20.4607, 44.7816], 'الأفلاج': [22.2833, 46.7333], 'العلا': [26.6085, 37.9232], 'الوجه': [26.2455, 36.4525],
};
const ALIAS = { 'مكة المكرمة': 'مكة', 'المدينة المنورة': 'المدينة', 'الهفوف': 'الأحساء', 'الاحساء': 'الأحساء', 'الجوف': 'سكاكا',
  'جيزان': 'جازان', 'خميس': 'خميس مشيط', 'الخماسين': 'وادي الدواسر', 'ليلى': 'الأفلاج', 'القصيم': 'بريدة', 'ابها': 'أبها' };

// stadiums known by name rather than city
const STADIUMS = [
  ['الملك فهد الدولي', 'الرياض'], ['الأول بارك', 'الرياض'], ['مرسول بارك', 'الرياض'], ['المملكة أرينا', 'الرياض'],
  ['الأمير فيصل بن فهد', 'الرياض'], ['الجوهرة', 'جدة'], ['الملك عبدالله الرياضية بجدة', 'جدة'], ['الأمير عبدالله الفيصل', 'جدة'],
  ['الملك عبدالعزيز الرياضية', 'مكة'], ['الأمير محمد بن فهد', 'الدمام'], ['الأمير عبدالله بن جلوي', 'الأحساء'],
  ['الأمير سلطان بن عبدالعزيز', 'أبها'], ['الأمير عبدالعزيز بن مساعد', 'حائل'], ['الأمير هذلول', 'نجران'],
  ['الأمير محمد بن عبدالعزيز', 'المدينة'], ['الملك خالد', 'الرياض'],
];

// club -> home city. A match is played at the home club's ground.
const CLUBS = {
  'الهلال': 'الرياض', 'النصر': 'الرياض', 'الشباب': 'الرياض', 'الرياض': 'الرياض', 'الاتحاد': 'جدة', 'الأهلي': 'جدة',
  'جدة': 'جدة', 'الاتفاق': 'الدمام', 'النهضة': 'الدمام', 'الفتح': 'الأحساء', 'هجر': 'الأحساء', 'العدالة': 'الأحساء',
  'الروضة': 'الأحساء', 'الجيل': 'الأحساء', 'القادسية': 'الخبر', 'الثقبة': 'الخبر', 'الخليج': 'سيهات', 'مضر': 'القطيف',
  'الصفا': 'صفوى', 'التعاون': 'بريدة', 'الرائد': 'بريدة', 'النجمة': 'عنيزة', 'العربي': 'عنيزة', 'الحزم': 'الرس',
  'الخلود': 'الرس', 'البكيرية': 'البكيرية', 'الفيحاء': 'المجمعة', 'الفيصلي': 'حرمة', 'الزلفي': 'الزلفي', 'الكوكب': 'الخرج',
  'الشعلة': 'الخرج', 'الطائي': 'حائل', 'الجبلين': 'حائل', 'الوحدة': 'مكة', 'الأنصار': 'المدينة', 'أحد': 'المدينة',
  'ضمك': 'خميس مشيط', 'أبها': 'أبها', 'الأخدود': 'نجران', 'العروبة': 'سكاكا', 'الجندل': 'دومة الجندل', 'الباطن': 'حفر الباطن',
  'العين': 'الباحة', 'الدرعية': 'الدرعية', 'العلا': 'العلا',
};

// airports, for the length of a flight
const AIRPORTS = [
  ['الرياض', 24.9576, 46.6988], ['جدة', 21.6796, 39.1565], ['الدمام', 26.4712, 49.7979], ['المدينة', 24.5534, 39.7051],
  ['القصيم', 26.3028, 43.7744], ['الأحساء', 25.2853, 49.4852], ['أبها', 18.2404, 42.6566], ['جازان', 16.9011, 42.5858],
  ['نجران', 17.6114, 44.4192], ['الطائف', 21.4834, 40.5443], ['تبوك', 28.3654, 36.6189], ['حائل', 27.4379, 41.6863],
  ['الجوف', 29.7851, 40.1000], ['عرعر', 30.9066, 41.1382], ['القيصومة', 28.3352, 46.1250], ['بيشة', 19.9844, 42.6209],
  ['الباحة', 20.2961, 41.6343], ['ينبع', 24.1442, 38.0634], ['العلا', 26.4833, 38.1169], ['القريات', 31.4118, 37.2795],
  ['وادي الدواسر', 20.5043, 45.1996],
];

const norm = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة\b/g, 'ه').replace(/ى\b/g, 'ي').replace(/\s+/g, ' ').trim();
// the whole word, alone or after «ب» (بالأحساء، بجدة); «ال» is part of the word, so
// «مدينة» never matches «المدينة»
const has = (text, word) => new RegExp(`(^|[\\s،,.(\\-])ب?${norm(word)}($|[\\s،,.)\\-])`).test(norm(text));
const city = name => { const n = ALIAS[name] || name; return C[n] ? { city: n, lat: C[n][0], lon: C[n][1] } : null; };
const NAMES = [...Object.keys(C), ...Object.keys(ALIAS)].sort((a, b) => b.length - a.length);

// {venue, home, away} -> { city, lat, lon, via: 'venue'|'stadium'|'club' } or null
export function locate({ venue, home } = {}){
  const v = String(venue || '');
  if (v){
    const st = STADIUMS.find(([n]) => norm(v).includes(norm(n)));
    if (st) return { ...city(st[1]), via: 'stadium' };
    const club = Object.keys(CLUBS).find(k => /نادي/.test(v) && has(v.split(/نادي/)[1] || '', k));
    if (club) return { ...city(CLUBS[club]), via: 'club' };
    const n = NAMES.find(k => has(v, k));
    if (n) return { ...city(n), via: 'venue' };
  }
  const h = String(home || '').replace(/^نادي\s*/, '').trim();
  const club = Object.keys(CLUBS).find(k => norm(h) === norm(k) || has(h, k));
  if (club) return { ...city(CLUBS[club]), via: 'club' };
  const n = h && NAMES.find(k => has(h, k));
  return n ? { ...city(n), via: 'club' } : null;
}

export function km(a, b){
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
const half = h => Math.max(0.5, Math.round(h * 2) / 2);
const nearestAirport = p => AIRPORTS.map(([n, lat, lon]) => ({ n, lat, lon, d: km(p, { lat, lon }) })).sort((a, b) => a.d - b.d)[0];

// place: locate()'s result; route: {km, hours} of the real road when known.
// -> { mode: ''|'car'|'plane', hours, road_km, city, estimated, via, airports? }
export function travelFor(place, from = HOME, route = null){
  if (!place || place.lat == null) return null;
  const road = route && route.km > 0 ? route.km : km(from, place) * ROAD;
  const base = { city: place.city || '', road_km: Math.round(road), estimated: !(route && route.km > 0), via: place.via || '' };
  if (road < LOCAL_KM) return { ...base, mode: '', hours: 0 };
  if (road <= FLY_KM) return { ...base, mode: 'car', hours: half(route && route.hours > 0 ? route.hours * 1.1 : road / 90) };
  // door to stadium by air: drive to the airport, an hour and a half there, the
  // flight, half an hour for the bags, then the drive to the stadium
  const [n, lat, lon] = AIRPORTS.find(x => x[0] === HOME_AIRPORT);
  const a = { n, lat, lon }, b = nearestAirport(place);
  // a stadium whose nearest airport is the one he flies from is a drive, however far
  if (b.n === a.n) return { ...base, mode: 'car', hours: half(route && route.hours > 0 ? route.hours * 1.1 : road / 90) };
  const drive = (p, q) => Math.max(0.5, km(p, q) * ROAD / 100);
  const hours = drive(from, a) + 1.5 + km(a, b) / 700 + 0.5 + 0.5 + drive(b, place);
  return { ...base, mode: 'plane', hours: half(hours), airports: [a.n, b.n] };
}
