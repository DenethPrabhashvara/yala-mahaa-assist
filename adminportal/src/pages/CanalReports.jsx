import { useCallback, useEffect, useState } from 'react'
import { Camera, ChevronRight, ClipboardList, Inbox, MapPin, RefreshCw, Wrench } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateTime } from '../utils/format'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Overlay'

// Canal problems farmers report from the farmer portal (/api/reports), read and updated
// through /admin/reports. Officers can view; admins and super admins change the status.
const STATUS = {
  received: { label: 'New', tone: 'info' },
  inProgress: { label: 'In progress', tone: 'warning' },
  fixed: { label: 'Fixed', tone: 'success' },
}
const ISSUE = { blockage: 'Blocked / silted', leak: 'Water leak', gate: 'Broken gate', other: 'Something else' }
const FILTERS = [['all', 'All'], ['received', 'New'], ['inProgress', 'In progress'], ['fixed', 'Fixed']]

function useReports(status) {
  const [state, setState] = useState({ rows: [], counts: {}, loading: true, error: null })
  const load = useCallback(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api(`/admin/reports${status === 'all' ? '' : `?status=${status}`}`)
      .then((res) => live && setState({ rows: res.data, counts: res.counts, loading: false, error: null }))
      .catch((error) => live && setState((s) => ({ ...s, loading: false, error: error.message })))
    return () => {
      live = false
    }
  }, [status])
  useEffect(() => load(), [load])
  return { ...state, reload: load }
}

export function CanalReports() {
  const { canEdit } = useAuth()
  const { toast } = useToast()
  const [filter, setFilter] = useState('all')
  const list = useReports(filter)
  const [open, setOpen] = useState(null)
  const [saving, setSaving] = useState(false)
  const total = Object.values(list.counts).reduce((a, b) => a + b, 0)

  const openReport = async (row) => {
    setOpen({ ...row, photo: undefined })
    try {
      const res = await api(`/admin/reports/${row.id}`)
      setOpen(res.data)
    } catch (error) {
      toast(error.message, { tone: 'error' })
    }
  }

  const setStatus = async (status) => {
    setSaving(true)
    try {
      await api(`/admin/reports/${open.id}`, { method: 'PATCH', body: { status } })
      setOpen((r) => ({ ...r, status }))
      list.reload()
      toast(`${open.report_no} marked ${STATUS[status].label.toLowerCase()}.`, { tone: 'success' })
    } catch (error) {
      toast(error.message, { tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Farmer services"
        badge={
          <Badge tone={list.counts.received ? 'info' : 'success'} dot>
            {list.counts.received || 0} new
          </Badge>
        }
        title="Canal reports"
        description="Blocked channels, leaks and broken gates reported by farmers from the farmer portal."
        actions={
          <Button icon={RefreshCw} variant="secondary" loading={list.loading} onClick={list.reload}>
            Refresh
          </Button>
        }
      />

      <Card className="table-card">
        <CardHeader icon={ClipboardList} title="Reports" subtitle={`${total} in total · newest first`} />
        <div className="schedule-toolbar">
          <div className="segmented">
            {FILTERS.map(([value, label]) => (
              <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {label}
                {value !== 'all' && ` (${list.counts[value] || 0})`}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>Problem</th>
                <th>Where</th>
                <th>Farmer</th>
                <th>Status</th>
                <th>Sent</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable-row" onClick={() => openReport(r)}>
                  <td>
                    <strong>{r.report_no}</strong>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <strong>{ISSUE[r.issue_type] || r.issue_type}</strong>
                      <small>{r.has_photo ? 'With photo' : r.note ? 'Note only' : '—'}</small>
                    </div>
                  </td>
                  <td className="muted-cell">{r.location}</td>
                  <td>
                    <div className="cell-stack">
                      <strong>{r.full_name || 'Deleted farmer'}</strong>
                      <small>{[r.farm_id, r.district].filter(Boolean).join(' · ')}</small>
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS[r.status]?.tone} dot>
                      {STATUS[r.status]?.label || r.status}
                    </Badge>
                  </td>
                  <td className="muted-cell">{formatDateTime(r.created_at)}</td>
                  <td>
                    <ChevronRight size={15} className="row-chevron" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && list.rows.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">
              <Inbox size={22} />
            </span>
            <strong>{list.error ? 'Reports could not be loaded' : 'No reports here'}</strong>
            <span>{list.error || 'Reports farmers send from the farmer portal appear here.'}</span>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        icon={Wrench}
        title={open ? `${open.report_no} · ${ISSUE[open.issue_type] || open.issue_type}` : ''}
        description={open ? `Sent ${formatDateTime(open.created_at)}` : ''}
        footer={
          open &&
          canEdit && (
            <>
              {Object.entries(STATUS)
                .filter(([key]) => key !== open.status)
                .map(([key, meta]) => (
                  <Button key={key} variant={key === 'fixed' ? 'primary' : 'secondary'} loading={saving} onClick={() => setStatus(key)}>
                    Mark {meta.label.toLowerCase()}
                  </Button>
                ))}
            </>
          )
        }
      >
        {open && (
          <div className="cell-stack" style={{ gap: 12 }}>
            <div>
              <Badge tone={STATUS[open.status]?.tone} dot>
                {STATUS[open.status]?.label}
              </Badge>
            </div>
            <div className="cell-stack">
              <small>
                <MapPin size={13} /> Where
              </small>
              <strong>{open.location}</strong>
            </div>
            <div className="cell-stack">
              <small>Farmer</small>
              <strong>
                {open.full_name || 'Deleted farmer'}
                {open.phone ? ` · ${open.phone}` : ''}
              </strong>
              <small>{[open.farm_id, open.division, open.district].filter(Boolean).join(' · ')}</small>
            </div>
            {open.note && (
              <div className="cell-stack">
                <small>Note</small>
                <span>{open.note}</span>
              </div>
            )}
            {open.has_photo && (
              <div className="cell-stack">
                <small>
                  <Camera size={13} /> Photo
                </small>
                {open.photo === undefined ? (
                  <span>Loading photo…</span>
                ) : (
                  open.photo && <img src={open.photo} alt={`Photo for ${open.report_no}`} style={{ maxWidth: '100%', borderRadius: 12 }} />
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
