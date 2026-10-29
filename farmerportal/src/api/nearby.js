// What is relevant to one farm: its river gauge, rain forecast and water release, chosen from the
// farm pin and the water source the farmer registered (tank, canal or river).
import { haversine } from './googleMaps.js';
import { canalScheme, useApiData, useFarmReservoirs } from './reservoirs.js';
import { useRivers } from './rivers.js';
import { useCanals } from './canals.js';

const GAUGE_RADIUS_M = 30000;   // a gauge further away than this says little about the farm
const CANAL_RADIUS_M = 10000;   // a scheme tank further away is unlikely to feed the farm

const norm = (s) => (s || '').trim().toLowerCase();

// "Minneriya" matches "Minneriya", "Minneriya wewa" and "Minneriya (…)"
export function sameScheme(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

export const farmPin = (farm) => (farm?.pin?.lat != null ? farm.pin : null);

// 0 normal, 1 alert, 2 minor flood, 3 major flood
export function floodLevel(s) {
  if (s.level == null) return 0;
  if (s.major != null && s.level >= s.major) return 3;
  if (s.minor != null && s.level >= s.minor) return 2;
  if (s.alert != null && s.level >= s.alert) return 1;
  return 0;
}

function nearestGauge(rivers, pin, onRiver) {
  let best = null;
  for (const river of rivers) {
    if (onRiver && norm(river.name) !== norm(onRiver)) continue;
    for (const s of river.stations) {
      const d = haversine(pin, s);
      if (!best || d < best.d) best = { ...s, river: river.name, d };
    }
  }
  return best;
}

// The gauge to watch: the nearest one on the farmer's own river, otherwise the nearest within 30 km
// (also when their river has no gauge).
export function useFarmGauge(farm) {
  const rivers = useRivers();
  const pin = farmPin(farm);
  let gauge = null;
  if (rivers.data && pin) {
    const own = farm?.water?.source === 'river' ? farm.water.name : null;
    gauge = own ? nearestGauge(rivers.data, pin, own) : null;
    if (!gauge) {
      gauge = nearestGauge(rivers.data, pin, null);
      if (gauge && gauge.d > GAUGE_RADIUS_M) gauge = null;
    }
  }
  if (gauge) {
    gauge.floodLevel = floodLevel(gauge);
    gauge.trend = gauge.previous == null || gauge.level == null ? null
      : gauge.level > gauge.previous + 0.02 ? 'rising' : gauge.level < gauge.previous - 0.02 ? 'falling' : 'steady';
  }
  return { ...rivers, data: gauge };
}

// Open-Meteo's free forecast (no key) for the farm pin: rain over the next 3 days.
async function fetchRain(pin) {
  const params = new URLSearchParams({
    latitude: pin.lat.toFixed(3),
    longitude: pin.lng.toFixed(3),
    daily: 'precipitation_sum,precipitation_probability_max,weather_code',
    timezone: 'Asia/Colombo',
    forecast_days: '3',
  });
  let res;
  try {
    res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  } catch {
    throw new Error('offline');
  }
  if (!res.ok) throw new Error(`Weather service error (${res.status})`);
  const { daily } = await res.json();
  return daily.time.map((date, i) => ({
    date,
    mm: Math.round((daily.precipitation_sum[i] ?? 0) * 10) / 10,
    chance: daily.precipitation_probability_max?.[i] ?? null,
    code: daily.weather_code?.[i] ?? 0,
  }));
}

export function useRainForecast(farm) {
  const pin = farmPin(farm);
  return useApiData(pin ? `rain:${pin.lat.toFixed(2)},${pin.lng.toFixed(2)}` : null, () => fetchRain(pin));
}

// WMO weather code → the app's three weather icons
export const weatherIcon = (code, mm) => (mm >= 1 || code >= 51 ? 'rain' : code >= 2 ? 'cloud' : 'sun');

// Advice key from the 3-day rain total and the wettest day
export function rainAdviceKey(days) {
  const total = days.reduce((s, d) => s + d.mm, 0);
  if (days.some((d) => d.mm >= 25)) return 'rainAdviceHeavy';
  if (total < 5) return 'rainAdviceDry';
  return 'rainAdviceSome';
}

const slToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function releaseStatus(c, today = slToday()) {
  if (!c.start || !c.end) return null;
  if (today < c.start) return 'scheduled';
  if (today > c.end) return 'closed';
  return 'flowing';
}

// The farm's canal sections from the water issue schedule: the canal the farmer chose, else the
// sections of their own tank's scheme, else the nearest scheme within 10 km of the pin.
export function useFarmRelease(farm) {
  const canals = useCanals();
  const tanks = useFarmReservoirs(farm);
  const ownTank = tanks.data?.find((r) => r.own)?.name;
  const list = canals.data || [];
  let scheme = null;
  let mine = null;
  if (farm?.water?.source === 'canal' && farm.water.name) {
    mine = list.find((c) => norm(c.name) === norm(farm.water.name)) || null;
    scheme = mine?.scheme || canalScheme(farm.water.name);
  }
  if (!scheme && ownTank && list.some((c) => sameScheme(c.scheme, ownTank))) scheme = list.find((c) => sameScheme(c.scheme, ownTank)).scheme;
  const pin = farmPin(farm);
  if (!scheme && pin) {
    const near = list.filter((c) => c.lat != null).map((c) => ({ c, d: haversine(pin, c) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= CANAL_RADIUS_M) scheme = near.c.scheme;
  }
  const sections = scheme ? list.filter((c) => sameScheme(c.scheme, scheme)).map((c) => ({ ...c, status: releaseStatus(c) })) : [];
  // The one to headline: the farmer's own canal, else one flowing now, else the next to start
  const order = { flowing: 0, scheduled: 1, closed: 2 };
  const main = (mine && sections.find((c) => c.name === mine.name))
    || [...sections].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.start || '').localeCompare(b.start || ''))[0]
    || null;
  return { ...canals, loading: canals.loading || tanks.loading, data: main ? { scheme, main, sections } : null };
}
