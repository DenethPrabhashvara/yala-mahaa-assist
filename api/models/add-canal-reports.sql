-- Canal problem reports from the farmer portal, and each farmer's SMS preference.
-- Run once on an existing database: psql -d yala-maha-api -f add-canal-reports.sql
-- (schema.sql already has both for new databases.)

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS canal_reports (
  id          SERIAL PRIMARY KEY,
  farmer_id   UUID REFERENCES farmers(farmer_id) ON DELETE SET NULL,
  issue_type  TEXT NOT NULL CHECK (issue_type IN ('blockage', 'leak', 'gate', 'other')),
  location    TEXT NOT NULL,
  note        TEXT,
  photo       BYTEA,                                   -- JPEG, resized by the portal before upload
  status      TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'inProgress', 'fixed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canal_reports_farmer ON canal_reports (farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canal_reports_status ON canal_reports (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_canal_reports_updated_at ON canal_reports;
CREATE TRIGGER trg_canal_reports_updated_at BEFORE UPDATE ON canal_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
