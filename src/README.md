# Yala-Maha Assist — Admin Panel

React + Vite dashboard for irrigation officers. It shows Mahaweli tank and reservoir readings, reservoir coverage records, and sends SMS broadcasts to registered farmers through Text.lk.

The panel lives at the repo root (`index.html`, `vite.config.mjs`, `src/`) and talks to the Express API in `api/`. The farmer-facing app is separate: see `reactfarmerportalmekawenaskrpn/README.md`.

## Run it

The panel needs the API (port 8005) and its PostgreSQL database. Set up the database and `api/config.env` as described in the root `README.md`.

```bash
# 1. API, in its own terminal
cd api
npm install
node server.js     # or: npm run api (restarts on changes)

# 2. Admin panel, from the repo root
npm install
npm run dev        # http://localhost:5173, also reachable on your LAN
npm run build      # production build in dist/
npm run preview    # serve the build
npm test           # tests for the src/api helpers
```

If the farmer portal dev server is already on 5173, Vite moves to the next free port and prints it.

## First officer account

The SMS Gateway tab needs an officer sign-in. There is no sign-up page or endpoint. Create accounts from the CLI:

```bash
cd api
node create-admin.js <USERNAME> <PASSWORD> <officer|admin|super_admin> "<FULL NAME>"
```

The password must be at least 10 characters. This needs the `admins` table from `api/models/schema.sql` and `JWT_ADMIN_SECRET` in `api/config.env`. All three roles can currently use every SMS feature.

## Configuration

| Variable | File | Purpose |
|---|---|---|
| `VITE_API_BASE` | root `.env` | API base URL. Default `http://127.0.0.1:8005/api`. Officer sign-in goes to the same host without `/api` (`/admin/login`). Restart `npm run dev` after changing it. |
| `JWT_ADMIN_SECRET` | `api/config.env` | Signs officer tokens. Use a long random string. |
| `TEXTLK_API_TOKEN`, `TEXTLK_SENDER_ID` | `api/config.env` | Text.lk account used for broadcasts. |
| `SMS_DRY_RUN` | `api/config.env` | `true` simulates every send: nothing is charged, and the broadcast is logged as "Dry run". |

Never put the Text.lk token in a `VITE_` variable: anything with that prefix is bundled into the browser code.

## Tabs

| Tab | What it shows | API calls |
|---|---|---|
| Dashboard | Tanks reporting, average storage, average 24-hour rain and last check time. Water Management table for the Mahaweli tanks (storage bar turns red at 90% or more and amber below 30%). Reservoir records table, 10 rows at a time. "Refresh data" reloads the tanks. | `GET /mahaweli`, `GET /reservoir` |
| River | Placeholder. No river data source is connected. | none |
| Coverage Map | Reservoir table with district, division, farmland, type and coordinates. The geographic map is a placeholder. | `GET /reservoir` |
| SMS Gateway | Officer sign-in, then today's totals, the broadcast composer, a three-language preview and the broadcast history. | see [SMS Gateway](#sms-gateway) |
| Farmer Portal | Placeholder. | none |

"Quick Broadcast SMS" in the header opens the SMS Gateway tab.

### Picking a tank or reservoir

The "Reservoir / Tank" picker in the nav bar narrows the Dashboard and Coverage Map to one record. The choice stays when you switch tabs.

- **Mahaweli tank:** water level, storage percentage and a tank graphic with capacity, current volume and level above MSL. There is no history or rainfall feed for tanks yet.
- **Reservoir:** also loads up to 30 days of readings from `GET /reservoir/:id/history`. These drive a usable-storage chart, a 7-day rainfall chart (previous-day rainfall as reported, not a forecast), and spill status, spill rate and downstream impact.

## SMS Gateway

### Sign-in

Officers sign in with the username and password from `create-admin.js`. The token is kept in `sessionStorage`, so closing the tab signs the officer out. The API token also expires after 8 hours. Any `401` from the API returns the officer to the sign-in card.

### Sending a broadcast

1. **Target group:** All farmers, By tank (a tank or reservoir), By district, or Custom numbers (comma-separated). Group sizes come from active rows in the `farmers` table.
2. **Language:** Sinhala, Tamil or English. Switching language loads the current template in that language.
3. **Quick template:** Water release, Low level alert, Rain warning or Canal maintenance. The templates contain example names and times ("Tank C", "Kudawewa", "Thursday 6:00 AM"), so edit the message before sending.
4. **Message:** the counter shows characters and SMS segments.

An SMS holds 160 characters (153 per part when split). Any non-ASCII character, such as Sinhala, Tamil, `—` or curly quotes, switches the whole message to Unicode: 70 characters (67 per part). The rule in `smsSegmentInfo()` (`src/api/sms.mjs`) must match `countSegments()` in `api/services/smsService.js`. If you change one, change both.

**Send SMS Broadcast** asks for confirmation, showing the recipient count and estimated credits. The button stays disabled while sending, so a double click cannot text everyone twice. The API sends in batches of 100, and a failed batch does not stop the rest. Invalid numbers are skipped and not charged. The result line reports how many were sent, failed and skipped.

### Totals and history

- **Stat cards:** messages sent, credits used, invalid numbers and failed sends since midnight Sri Lanka time. Dry runs are not counted.
- **Outbound Alert History:** the last 20 broadcasts with their status: Sent, *N* failed, Failed or Dry run.

Each broadcast is one row in `sms_broadcasts`, linked to the officer who sent it.

### Endpoints used

| Method | Path | Notes |
|---|---|---|
| `POST` | `/admin/login` | `{ username, password }` → `{ accessToken, admin }` |
| `GET` | `/api/sms/groups` | All / by tank or reservoir / by district, with farmer counts |
| `POST` | `/api/sms/broadcast` | `{ group: { type, value }, message }` → `{ sent, failed, invalid, logged }` |
| `GET` | `/api/sms/history` | Last 20 broadcasts and today's totals |

Every `/api/sms/*` call sends `Authorization: Bearer <accessToken>`.

## Known gaps

- **Tank and reservoir data does not load against the current API.** `api/app.js` mounts the data routes under `/api/data` (`/api/data/mahaweli`, `/api/data/reservoir`…), but the panel requests `/api/mahaweli` and `/api/reservoir`. The Dashboard and Coverage Map show "Could not load…" errors. Setting `VITE_API_BASE` to `…/api/data` does not fix it, because SMS Gateway then calls `/api/data/sms/…`. Fix the paths in `src/hooks/useTanks.js`, `useReservoirs.js` and `useReservoirHistory.js`, or mount the data routes back at `/api`.
- **The "Level history" card shows a sample chart** (hard-coded values in `HistoryPlaceholder.jsx`) whenever no reservoir is selected. Only a selected reservoir shows real readings.
- The "Farmer contacts" card, the River tab, the geographic coverage map and the Farmer Portal tab are not connected yet.

## Structure

```
index.html                  page shell: fonts, /css/style.css, src/main.jsx
vite.config.mjs             React plugin; publicDir is off
src/
  App.jsx                   current tab, tank/reservoir picker, page switch
  api/
    client.mjs              fetch wrapper; API_BASE and API_ORIGIN
    records.mjs             row unwrapping, number/date formatting, reservoir history helpers
    sms.mjs                 officer session, login, SMS requests, segment counter, templates
  hooks/
    useTanks.js             tank list with manual refresh
    useReservoirs.js        reservoir list
    useReservoirHistory.js  readings for the selected reservoir
    useSmsGateway.js        session, groups, history, broadcast; signs out on 401
  components/
    Header.jsx              brand bar, tabs, record picker
    Dashboard.jsx           stat cards and tables, or the selected-record view
    TankTable.jsx, ReservoirTable.jsx, SelectedWaterManagement.jsx
    HistoryPlaceholder.jsx  level and rainfall charts (real for reservoirs, sample otherwise)
    CoveragePage.jsx
    SmsGatewayPage.jsx      sign-in gate, stat cards, layout
    AdminLogin.jsx, SmsComposer.jsx, SmsHistory.jsx
    PlaceholderPage.jsx     River and Farmer Portal tabs
    shared.jsx              PageTitle, StatCard, Notice
css/style.css               styles for the panel
test/test-suite.js          node:test tests for src/api (Node 18+)
```
