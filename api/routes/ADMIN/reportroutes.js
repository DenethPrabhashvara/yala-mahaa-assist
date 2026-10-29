const express = require('express')
const db = require('../../config/db.js')
const { REPORT_COLUMNS } = require('../reportroutes.js')

// Canal problem reports sent from the farmer portal (/admin/reports)
const STATUSES = ['received', 'inProgress', 'fixed']
const SELECT_REPORT = `SELECT r.id, 'CR-' || lpad(r.id::text, 4, '0') AS report_no, r.issue_type, r.location, r.note, r.status,
                              r.photo IS NOT NULL AS has_photo, r.created_at, r.updated_at,
                              f.farmer_id, f.farm_id, f.full_name, f.phone, f.district, f.division`
const FROM_REPORTS = 'FROM canal_reports r LEFT JOIN farmers f ON f.farmer_id = r.farmer_id'

const adminreportrouter = express.Router()

// ?status=received|inProgress|fixed
adminreportrouter.get('/', async (req, res, next) => {
    try {
        const status = STATUSES.includes(req.query.status) ? req.query.status : null
        const [rows, counts] = await Promise.all([
            db.query(`${SELECT_REPORT} ${FROM_REPORTS} WHERE $1::text IS NULL OR r.status = $1 ORDER BY r.created_at DESC LIMIT 500`, [status]),
            db.query('SELECT status, count(*)::int AS n FROM canal_reports GROUP BY status'),
        ])
        res.status(200).json({
            status: 'success',
            data: rows.rows,
            counts: Object.fromEntries(STATUSES.map(s => [s, counts.rows.find(c => c.status === s)?.n || 0])),
        })
    } catch (error) {
        next(error)
    }
})

// One report, with its photo as a data URL
adminreportrouter.get('/:id', async (req, res, next) => {
    try {
        const result = await db.query(`${SELECT_REPORT}, r.photo ${FROM_REPORTS} WHERE r.id = $1`, [Number(req.params.id) || 0])
        const row = result.rows[0]
        if (!row) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
        const { photo, ...report } = row
        res.status(200).json({ status: 'success', data: { ...report, photo: photo ? `data:image/jpeg;base64,${photo.toString('base64')}` : null } })
    } catch (error) {
        next(error)
    }
})

// Body: { status }
adminreportrouter.patch('/:id', async (req, res, next) => {
    try {
        const { status } = req.body || {}
        if (!STATUSES.includes(status)) {
            return res.status(400).json({ status: 'fail', message: `Status must be one of ${STATUSES.join(', ')}.` })
        }
        const result = await db.query(
            `UPDATE canal_reports SET status = $2 WHERE id = $1 RETURNING ${REPORT_COLUMNS}`,
            [Number(req.params.id) || 0, status]
        )
        if (!result.rows[0]) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
        res.status(200).json({ status: 'success', message: 'Report updated.', data: result.rows[0] })
    } catch (error) {
        next(error)
    }
})

module.exports = adminreportrouter
