// The farmer's alerts, worked out from live data for their own farm: their tank's latest reading,
// the nearest river gauge, their water release and the status of reports they sent.
// Nothing is stored here; which alerts were read is kept in app state (readAlerts).
import { useApiData, useFarmReservoirs, useReservoirReadings } from './reservoirs.js';
import { useFarmGauge, useFarmRelease } from './nearby.js';
import { listReports } from './auth.js';
import { fmtDay } from '../components/ForecastChart.jsx';

// "{name} is low" with { name: 'Minneriya' } → "Minneriya is low"
export const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (values[k] ?? m));

const SOON_DAYS = 7;
const DATE = { day: 'numeric', month: 'short' };

export function useMyReports(enabled = true) {
  return useApiData(enabled ? 'reports' : null, listReports);
}

export function useFarmAlerts(farm, t, lang) {
  const tanks = useFarmReservoirs(farm);
  const tank = tanks.data?.find((r) => r.own) || null;
  const readings = useReservoirReadings(tank?.id);
  const gauge = useFarmGauge(farm).data;
  const release = useFarmRelease(farm).data;
  const reports = useMyReports(Boolean(farm)).data || [];
  const day = (d) => fmtDay(d, lang, DATE);
  const alerts = [];

  const latest = readings.data?.latest;
  if (tank && latest) {
    if (latest.spilling) {
      alerts.push({ id: `spill:${tank.id}:${latest.date}`, kind: 'flood', when: day(latest.date),
        title: fill(t('alertSpillTitle'), { name: tank.name }), body: t('alertSpillBody') });
    } else if (latest.percent != null && latest.percent < 30) {
      alerts.push({ id: `low:${tank.id}:${latest.date}`, kind: 'tank', when: day(latest.date),
        title: fill(t('alertTankLowTitle'), { name: tank.name }), body: fill(t('alertTankLowBody'), { pct: Math.round(latest.percent) }) });
    }
  }

  if (gauge?.floodLevel > 0) {
    const at = gauge.at ? new Date(gauge.at) : null;
    alerts.push({ id: `flood:${gauge.river}:${gauge.name}:${gauge.floodLevel}:${at?.toISOString().slice(0, 10)}`, kind: 'flood',
      when: at ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }) : '',
      title: `${t(`floodLevel${gauge.floodLevel}`)} · ${gauge.river}`,
      body: fill(t('alertFloodBody'), { station: gauge.name, river: gauge.river, level: gauge.level }) });
  }

  const c = release?.main;
  if (c?.status === 'flowing') {
    alerts.push({ id: `release:${c.name}:${c.start}`, kind: 'release', when: day(c.start),
      title: t('alertReleaseNowTitle'), body: fill(t('alertReleaseNowBody'), { canal: c.name, end: day(c.end) }) });
  } else if (c?.status === 'scheduled' && (Date.parse(c.start) - Date.now()) / 864e5 <= SOON_DAYS) {
    alerts.push({ id: `release:${c.name}:${c.start}`, kind: 'release', when: day(c.start),
      title: fill(t('alertReleaseSoonTitle'), { date: day(c.start) }),
      body: fill(t('alertReleaseSoonBody'), { canal: c.name, start: day(c.start), end: day(c.end) }) });
  }

  for (const r of reports) {
    if (r.status === 'received') continue;
    alerts.push({ id: `report:${r.id}:${r.status}`, kind: r.status === 'fixed' ? 'report' : 'tank', when: day(r.updated_at.slice(0, 10)),
      title: fill(t('alertReportTitle'), { id: r.report_no, status: t(r.status) }), body: `${t(r.issue_type)} · ${r.location}` });
  }
  return alerts;
}
