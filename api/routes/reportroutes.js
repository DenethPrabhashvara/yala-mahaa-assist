const express = require('express')
const db = require('../config/db.js')
const requireFarmer = require('../middleware/requireFarmer.js')

// Canal problem reports from the farmer portal (/api/reports). Officers see them under /admin/reports.
const ISSUE_TYPES = ['blockage', 'leak', 'gate', 'other']
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const REPORT_COLUMNS = `id, 'CR-' || lpad(id::text, 4, '0') AS report_no, issue_type, location, note, status,
                        photo IS NOT NULL AS has_photo, created_at, updated_at`

// A data URL from the portal ("data:image/jpeg;base64,...") as a Buffer, or { error }
function readPhoto(photo) {
    if (photo == null || photo === '') return { buffer: null }
    const match = typeof photo === 'string' && photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return { error: 'The photo must be a JPEG, PNG or WebP image.' }
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > MAX_PHOTO_BYTES) return { error: 'The photo is too large (2 MB at most).' }
    return { buffer }
}

const reportrouter = express.Router()
reportrouter.use(requireFarmer)

// The signed-in farmer's reports, newest first
reportrouter.get('/', async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT ${REPORT_COLUMNS} FROM canal_reports WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT 100`,
            [req.farmerId]
        )
        res.status(200).json({ status: 'success', data: result.rows })
    } catch (error) {
        next(error)
    }
})

// Body: { issue_type, location, note?, photo? (data URL) }
reportrouter.post('/', async (req, res, next) => {
    try {
        const { issue_type, location, note, photo } = req.body || {}
        if (!ISSUE_TYPES.includes(issue_type)) {
            return res.status(400).json({ status: 'fail', message: 'Choose what is wrong.' })
        }
        if (typeof location !== 'string' || !location.trim()) {
            return res.status(400).json({ status: 'fail', message: 'Say where the problem is.' })
        }
        if (note != null && typeof note !== 'string') {
            return res.status(400).json({ status: 'fail', message: 'The note must be text.' })
        }
        const picture = readPhoto(photo)
        if (picture.error) return res.status(400).json({ status: 'fail', message: picture.error })

        const result = await db.query(
            `INSERT INTO canal_reports (farmer_id, issue_type, location, note, photo)
             VALUES ($1, $2, $3, $4, $5) RETURNING ${REPORT_COLUMNS}`,
            [req.farmerId, issue_type, location.trim().slice(0, 160), note?.trim().slice(0, 1000) || null, picture.buffer]
        )
        res.status(201).json({ status: 'success', message: 'Report received.', data: result.rows[0] })
    } catch (error) {
        // 23503: the farmer account was deleted while signed in
        if (error.code === '23503') return res.status(401).json({ status: 'fail', message: 'Farmer account not found.' })
        next(error)
    }
})

module.exports = { reportrouter, REPORT_COLUMNS }
