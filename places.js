// Happy Life – places near home, from OpenStreetMap.
// The phone asks three free services directly:
//   Nominatim  – turns the home address into a position
//   Overpass   – takeaway, restaurants, cinemas, theatres and florists around it
//   OSRM       – drive time from home to each place (falls back to an estimate
//                from the distance when the service is busy; shown as "ca.")
// The result is saved in the database (nearby_places) so it is fetched rarely.
import { cuisineGroup } from './catalog.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OSRM = 'https://router.project-osrm.org/table/v1/driving/';
const BATCH = 90;          // places per OSRM request
const PAUSE_MS = 1100;     // the public OSRM server asks for at most 1 request per second

// Restaurants whose food type is usually sold as takeaway count as takeaway
// unless OpenStreetMap says takeaway=no
const TAKEAWAY_LIKELY = ['pizza', 'burger', 'japanese', 'chinese', 'thai', 'vietnamese', 'asian',
  'indian', 'mideast', 'mexican', 'chicken', 'hotdog', 'korean', 'greek'];

export async function geocode(address, lang = 'da') {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=0&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': lang } });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const [hit] = await r.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name } : null;
}

// Straight-line distance in km
export function km(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Rough drive time: roads are ~1.35 × the straight line, at ~40 km/h on average (10 km ≈ 20 min)
export const estMinutes = (distKm) => Math.max(1, Math.round((distKm * 1.35 / 40) * 60));

export function overpassQuery(lat, lon, radiusM) {
  const a = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:90];(nwr["amenity"="fast_food"]${a};nwr["amenity"="restaurant"]${a};`
    + `nwr["amenity"="cinema"]${a};nwr["amenity"="theatre"]${a};nwr["shop"="florist"]${a};);out center tags;`;
}

// One OpenStreetMap element -> one row for nearby_places (or null if not useful)
export function toPlace(el, home) {
  const tg = el.tags || {};
  const name = (tg.name || '').trim();
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (!name || lat == null || lon == null) return null;
  const amenity = tg.amenity, ta = String(tg.takeaway || '').toLowerCase();
  const grp = amenity === 'fast_food' || amenity === 'restaurant' ? cuisineGroup(tg.cuisine) : null;
  const cats = [];
  if (amenity === 'fast_food' && ta !== 'no') cats.push('takeaway');
  if (amenity === 'restaurant') {
    if (ta === 'yes' || ta === 'only' || (!ta && TAKEAWAY_LIKELY.includes(grp))) cats.push('takeaway');
    if (ta !== 'only') cats.push('restaurant');
  }
  if (amenity === 'cinema') cats.push('cinema');
  if (amenity === 'theatre') cats.push('theatre');
  if (tg.shop === 'florist') cats.push('florist');
  if (!cats.length) return null;
  const street = tg['addr:street'] ? `${tg['addr:street']} ${tg['addr:housenumber'] || ''}`.trim() : '';
  const town = tg['addr:city'] || tg['addr:place'] || '';
  const d = km(home.lat, home.lon, lat, lon);
  return {
    osm_id: `${el.type}/${el.id}`, cats, name: name.slice(0, 120),
    cuisine: tg.cuisine ? String(tg.cuisine).slice(0, 120) : null, grp,
    address: [street, town].filter(Boolean).join(', ') || null,
    lat, lon, minutes: estMinutes(d), estimated: true,
    website: (tg.website || tg['contact:website'] || '').slice(0, 300) || null,
    phone: (tg.phone || tg['contact:phone'] || '').slice(0, 40) || null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let last;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
      if (r.ok) return await r.json();
      last = new Error(`Overpass ${r.status}`);
    } catch (e) { last = e; }
  }
  throw last;
}

// Places within `maxMin` minutes' drive of home, nearest first.
// onProgress(text) is called while it works.
export async function fetchNearby(home, maxMin = 20, onProgress = () => {}) {
  onProgress('search');
  const radius = Math.min(30000, maxMin * 800);   // 20 min -> 16 km straight line
  const data = await overpass(overpassQuery(home.lat, home.lon, radius));
  const byId = new Map();
  for (const el of data.elements || []) {
    const p = toPlace(el, home);
    if (p && !byId.has(p.osm_id)) byId.set(p.osm_id, p);
  }
  // Only ask for drive times where it could matter
  const all = [...byId.values()].filter((p) => p.minutes <= maxMin * 1.6);

  let routed = true;
  for (let i = 0; i < all.length && routed; i += BATCH) {
    onProgress('route', Math.min(i + BATCH, all.length), all.length);
    const part = all.slice(i, i + BATCH);
    const coords = [`${home.lon},${home.lat}`, ...part.map((p) => `${p.lon},${p.lat}`)].join(';');
    try {
      const r = await fetch(`${OSRM}${coords}?sources=0&annotations=duration`);
      const j = r.ok ? await r.json() : null;
      if (!j || j.code !== 'Ok') throw new Error('OSRM');
      part.forEach((p, k) => {
        const s = j.durations?.[0]?.[k + 1];
        if (typeof s === 'number') { p.minutes = Math.max(1, Math.round(s / 60)); p.estimated = false; }
      });
    } catch { routed = false; }   // keep the estimates for the rest
    if (routed && i + BATCH < all.length) await sleep(PAUSE_MS);
  }
  return all.filter((p) => p.minutes <= maxMin).sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name));
}
