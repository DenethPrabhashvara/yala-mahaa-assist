import { useApp } from '../state/AppContext.jsx';
import { IconBtn } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import { useFarmAlerts } from '../api/alerts.js';

const KIND = {
  flood: { icon: 'warn', cls: 'amber' },
  release: { icon: 'drop', cls: 'blue' },
  tank: { icon: 'tank', cls: 'soft' },
  report: { icon: 'check', cls: 'green' },
  farm: { icon: 'leaf', cls: 'accent' },
};

export default function Alerts() {
  const { t, lang, farm, readAlerts, update } = useApp();
  const alerts = useFarmAlerts(farm, t, lang);
  const isRead = (a) => readAlerts.includes(a.id);
  const unread = alerts.filter((a) => !isRead(a)).length;
  // Only ids of current alerts are kept, so the list doesn't grow forever
  const markRead = (ids) => update({ readAlerts: [...new Set([...readAlerts.filter((id) => alerts.some((a) => a.id === id)), ...ids])] });

  return (
    <div className="screen">
      <div className="row gap10">
        <IconBtn icon="back" label={t('back')} to="/home" />
        <div className="grow" />
        {unread > 0 && <button type="button" className="chip-white btn" onClick={() => markRead(alerts.map((a) => a.id))}>{t('markAllRead')}</button>}
      </div>
      <h1 className="h1">{t('alerts')}</h1>
      {alerts.length === 0 && (
        <div className="empty">
          <div className="icon-tile soft big"><Icon name="bell" size={30} /></div>
          <div className="f16 fw600">{t('noAlerts')}</div>
        </div>
      )}
      <div className="col gap10">
        {alerts.map((a) => {
          const k = KIND[a.kind] || KIND.tank;
          return (
            <button key={a.id} type="button" className={`alert-row ${isRead(a) ? '' : 'unread'}`} onClick={() => markRead([a.id])}>
              <div className={`icon-tile ${k.cls}`}><Icon name={k.icon} size={22} /></div>
              <div className="grow" style={{ textAlign: 'left' }}>
                <div className="row between gap8"><span className="f15 fw600">{a.title}</span><span className="f12 muted nowrap">{a.when}</span></div>
                <div className="f14 muted lh" style={{ marginTop: 2 }}>{a.body}</div>
              </div>
              {!isRead(a) && <span className="unread-dot" aria-label="Unread" />}
            </button>
          );
        })}
      </div>
      <div className="f13 muted lh center">{t('alertsNote')}</div>
    </div>
  );
}
