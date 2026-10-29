import { useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { PrimaryBtn, StatusLabel } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { ISSUE_TYPES } from '../data.js';
import { sendReport } from '../api/auth.js';
import { useMyReports } from '../api/alerts.js';
import { useFarmRelease } from '../api/nearby.js';
import { fmtDay } from '../components/ForecastChart.jsx';

const MAX_SIDE = 1280;

// A photo from the camera, shrunk to at most 1280 px and re-encoded as JPEG (a data URL).
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('photo')); };
    img.src = url;
  });
}

export default function Report() {
  const { t, lang, farm } = useApp();
  const reports = useMyReports();
  const release = useFarmRelease(farm);
  // Where it can be: the farm's own canal sections, near the farm, or a place the farmer types
  const places = [...(release.data?.sections.map((s) => s.name) || []), t('nearMyFarm')];
  const [type, setType] = useState(null);
  const [spot, setSpot] = useState(null);
  const [otherSpot, setOtherSpot] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spotOpen, setSpotOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [justSent, setJustSent] = useState(null);
  const fileRef = useRef();
  const place = spot === 'other' ? otherSpot.trim() : places.includes(spot) ? spot : places[0];

  const pickPhoto = async (file) => {
    if (!file) return;
    try { setPhoto(await shrinkPhoto(file)); } catch { setError(t('photoFailed')); }
  };

  const submit = async () => {
    if (!type) { setError(t('pickType')); return; }
    if (!place) { setError(t('pickPlace')); return; }
    setBusy(true);
    setError('');
    try {
      const location = place === t('nearMyFarm') && farm?.nearest ? `${t('nearMyFarm')} (${farm.nearest})` : place;
      const rep = await sendReport({ issue_type: type, location, note: note.trim(), photo });
      setJustSent(rep);
      setType(null); setNote(''); setPhoto(null);
      reports.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const label = (k) => t(ISSUE_TYPES.find((x) => x.id === k)?.key || 'other');
  const list = reports.data || [];

  return (
    <div className="screen">
      <div className="row gap10">
        <div className="grow" />
        <button type="button" className="chip-dark btn" onClick={() => setListOpen(true)}>{t('myReports')} ({list.length})</button>
      </div>

      <h1 className="h1">{t('reportTitle')}</h1>

      {justSent && (
        <div className="card card-dark confirm-card" role="status">
          <span className="ok-circle"><Icon name="check" size={20} stroke={2.8} /></span>
          <div className="grow">
            <div className="f15 fw600">{t('received')} · {justSent.report_no}</div>
            <div className="f13 dim lh">{t('receivedBody')}</div>
          </div>
          <button type="button" className="icon-btn glass sm" aria-label="Dismiss" onClick={() => setJustSent(null)}><Icon name="close" size={16} /></button>
        </div>
      )}

      <div className="f15 fw600">{t('whatWrong')}</div>
      <div className="issue-grid" role="radiogroup" aria-label={t('whatWrong')}>
        {ISSUE_TYPES.map((it) => (
          <button key={it.id} type="button" role="radio" aria-checked={type === it.id}
            className={`issue-tile ${type === it.id ? 'on' : ''}`} onClick={() => { setType(it.id); setError(''); }}>
            <span className="row between w100">
              <Icon name={it.icon} size={28} stroke={1.9} />
              {type === it.id && <span className="tick"><Icon name="check" size={12} stroke={3.4} color="var(--accent)" /></span>}
            </span>
            {t(it.key)}
          </button>
        ))}
      </div>

      <button type="button" className="card row-card" onClick={() => setSpotOpen(true)}>
        <Icon name="pin" size={22} />
        <div className="grow min0" style={{ textAlign: 'left' }}><div className="f12 muted">{t('where')}</div><div className="f15 fw600 ellipsis">{place || t('placeOther')}</div></div>
        <span className="f14 fw600 underline">{t('change')}</span>
      </button>
      {spot === 'other' && (
        <input className="input" autoFocus aria-label={t('placeType')} placeholder={t('placeType')} value={otherSpot}
          onChange={(e) => setOtherSpot(e.target.value.slice(0, 120))} />
      )}

      <label htmlFor="notes" className="f15 fw600">{t('tellMore')}</label>
      <div className="card tight">
        <textarea id="notes" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')} />
        {photo && (
          <div className="photo-prev">
            <img src={photo} alt="Attached" />
            <button type="button" className="icon-btn dark sm" aria-label="Remove photo" onClick={() => setPhoto(null)}><Icon name="close" size={14} /></button>
          </div>
        )}
        <div className="row gap8">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="pill-btn outline" onClick={() => fileRef.current?.click()}><Icon name="camera" size={18} />{t('addPhoto')}</button>
        </div>
      </div>
      {error && <div className="err-text" role="alert">{error}</div>}

      <PrimaryBtn onClick={submit} disabled={busy} icon="send">{busy ? '…' : t('sendDesk')}</PrimaryBtn>

      <Sheet open={spotOpen} onClose={() => setSpotOpen(false)} title={t('where')}>
        <div className="col gap8">
          {places.map((s) => (
            <button key={s} type="button" className={`option-row ${s === place ? 'on' : ''}`} onClick={() => { setSpot(s); setSpotOpen(false); }}>
              <Icon name="pin" size={18} /><span className="grow">{s}</span>{s === place && <Icon name="check" size={18} stroke={2.6} />}
            </button>
          ))}
          <button type="button" className={`option-row ${spot === 'other' ? 'on' : ''}`} onClick={() => { setSpot('other'); setSpotOpen(false); }}>
            <Icon name="pencil" size={18} /><span className="grow">{t('placeOther')}</span>{spot === 'other' && <Icon name="check" size={18} stroke={2.6} />}
          </button>
        </div>
      </Sheet>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title={t('myReports')}>
        <div className="col gap8">
          {!reports.data && <div className="f14 muted">{reports.error ? reports.error.message : t('loadingReports')}</div>}
          {reports.data && list.length === 0 && <div className="f14 muted">{t('noReports')}</div>}
          {list.map((r) => (
            <div key={r.id} className="report-row">
              <div className="icon-tile soft"><Icon name={ISSUE_TYPES.find((x) => x.id === r.issue_type)?.icon || 'dots'} size={22} /></div>
              <div className="grow min0">
                <div className="f15 fw600">{label(r.issue_type)} · {r.report_no}</div>
                <div className="f13 muted ellipsis">{r.location} · {fmtDay(r.created_at.slice(0, 10), lang, { day: 'numeric', month: 'short' })}</div>
              </div>
              <StatusLabel status={r.status}>{t(r.status)}</StatusLabel>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
