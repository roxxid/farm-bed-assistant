/* farm-bed shared client — API helpers, date utils, plant library cache */
const API = {
  async get(path) { const r = await fetch(path); if (!r.ok) throw new Error(r.status); return r.json(); },
  async post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw new Error(r.status); return r.json(); },
  async del(path) { const r = await fetch(path, { method: 'DELETE' }); if (!r.ok) throw new Error(r.status); return r.json(); },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDateFull(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

/* plant library — fetched once, cached */
let PLANTS_CACHE = null;
let RECOMMENDED_CACHE = null;
async function getPlants() {
  if (PLANTS_CACHE) return PLANTS_CACHE;
  const data = await API.get('/api/plants');
  PLANTS_CACHE = data.plants;
  RECOMMENDED_CACHE = data.recommended;
  return PLANTS_CACHE;
}
async function getRecommended() {
  if (!RECOMMENDED_CACHE) await getPlants();
  return RECOMMENDED_CACHE;
}

/* weather (placeholder — wire to a weather API / in-bed sensor later) */
const WEATHER = { temp: '62°F', sun: '6.1 h', moist: 'Damp' };
function renderWeather() {
  const t = $('#chipTemp'); if (t) t.textContent = WEATHER.temp;
  const s = $('#chipSun'); if (s) s.textContent = WEATHER.sun;
  const m = $('#chipMoist'); if (m) m.textContent = WEATHER.moist;
  const d = $('#chipDate'); if (d) d.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
