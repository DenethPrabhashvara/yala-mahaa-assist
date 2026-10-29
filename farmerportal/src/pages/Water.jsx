import { lazy, Suspense, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Link } from 'react-router-dom';
import { IconBtn } from '../components/UI.jsx';
import TankPicker from '../components/TankPicker.jsx';
import Icon from '../components/Icon.jsx';
import { COLORS } from '../theme.js';
import { fmtDay } from '../components/ForecastChart.jsx';
import { useFarmReservoirs, useReservoirReadings } from '../api/reservoirs.js';
import { useFarmRelease } from '../api/nearby.js';

const SHORT = { day: 'numeric', month: 'short' };

// Leaflet (~150 KB) only downloads when this page opens.
const WaterMap = lazy(() => import('../components/WaterMap.jsx'));

export default function Water() {
  const { t, lang, farm } = useApp();
  const tanks = useFarmReservoirs(farm);
  const tankList = tanks.data || [];
  const [picked, setPicked] = useState(null);
  const reservoirId = tankList.some((x) => x.id === picked) ? picked : tankList[0]?.id;
  const { data, error, reload } = useReservoirReadings(reservoirId);
  const release = useFarmRelease(farm);
  const week = (data?.history || []).slice(-7);
  const name = data?.reservoir.name || tankList.find((x) => x.id === reservoirId)?.name || '';
  const todayIso = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const loadError = tanks.error || error;

  return (
    <div className="water-screen">
      <Suspense fallback={<div className="water-map" />}>
        <WaterMap pin={farm?.pin} tankName={farm?.water?.source === 'tank' ? farm.water.name : null} t={t} />
      </Suspense>

      <div className="map-top">
        <IconBtn icon="back" label={t('back')} to="/home" variant="glass" />
        <div className="map-title">{t('tankCanals')}</div>
      </div>

      <div className="water-sheet">
        <div className="row between wrap gap10">
          <div className="f16 fw600 row gap8 nowrap"><Icon name="drop" size={18} />{t('tankLevel7')}</div>
        </div>
        {tankList.length > 1 && <TankPicker tanks={tankList} value={reservoirId} onChange={setPicked} dark />}
        {loadError && (
          <div className="row between gap8 f14">
            <span className="dim">{loadError.message}</span>
            <button type="button" className="link-btn" onClick={() => (tanks.error ? tanks.reload() : reload())}>{t('tryAgain')}</button>
          </div>
        )}
        {!loadError && !data && <div className="f14 dim">{t('loadingReadings')}</div>}
        {data && !week.length && <div className="f14 dim">{t('noReadings')}</div>}
        {week.length > 0 && (
          <>
            <div className="chart" role="img" aria-label={`${name} level over the last ${week.length} readings, now ${week[week.length - 1].percent}%`}>
              <div className="chart-line" style={{ bottom: '40%' }}><span>40%</span></div>
              {week.map((h, i) => {
                const last = i === week.length - 1;
                return (
                  <div key={h.date} className={`chart-bar ${last ? 'now' : ''}`} style={{ height: `${Math.min(100, h.percent)}%` }}>
                    {last && <span className="chart-tip">{Math.round(h.percent)}%</span>}
                  </div>
                );
              })}
            </div>
            <div className="chart-x" style={{ gridTemplateColumns: `repeat(${week.length}, minmax(0, 1fr))`, columnGap: 6 }}>
              {week.map((h, i) => (
                <span key={h.date} className={i === week.length - 1 ? 'on' : ''}>
                  {h.date === todayIso ? t('today') : fmtDay(h.date, lang, { day: 'numeric', month: 'short' })}
                </span>
              ))}
            </div>
          </>
        )}
        <Link to={`/forecast?reservoir=${reservoirId ?? ''}`} className="pill-btn accent big">
          <span className="row gap8"><Icon name="spark" size={18} />{t('seeForecast')}</span>
          <span className="round-arrow"><Icon name="arrow" size={18} color="#fff" stroke={2.4} /></span>
        </Link>
        <div className="hr dark" />
        <div className="f14 fw600">{t('releaseSchedule')}{release.data ? ` · ${release.data.scheme}` : ''}</div>
        {!release.data && <div className="f14 dim">{release.loading ? t('loadingRelease') : release.error ? release.error.message : t('noRelease')}</div>}
        {release.data && (
          <div className="col gap8">
            {release.data.sections.map((s) => {
              const on = s.status === 'flowing';
              const days = Math.round((Date.parse(s.end) - Date.parse(s.start)) / 864e5) + 1;
              return (
                <div key={s.name} className="sched-row">
                  <span className="sd" style={{ background: on ? 'var(--accent)' : COLORS.muted }} />
                  <span className={`grow min0 ${s === release.data.main ? 'fw600' : ''}`}>
                    <span className="block ellipsis">{s.name}</span>
                    <span className="block f13 dim">{fmtDay(s.start, lang, SHORT)} – {fmtDay(s.end, lang, SHORT)} · {t(s.status)}</span>
                  </span>
                  <span className="dim nowrap">{days} {t('days')}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
