# Yala-Maha Assist — Voice Alerts

Phones a short voice alert to a list of numbers through Twilio. It is for people who are not registered farmers (registered farmers get SMS from the admin panel). It runs from the command line and is not connected to the admin panel or the API.

## Setup

```bash
cd voice-alerts
npm install
```

`voice-alerts/.env` needs:

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY=SK...
TWILIO_API_SECRET=...
TWILIO_FROM_NUMBER=+1...      # a voice number on the Twilio account
```

In the Twilio Console:

- **Upgrade from trial.** Trial accounts can only call verified numbers and play a Twilio notice first.
- **Allow Sri Lanka** under Voice → Settings → Geo permissions, or every call fails with error 21215.

## Demo on a trial account

A trial account can call only the numbers verified in Twilio Console → Phone Numbers → Verified Caller IDs. The demo calls just one of them, with an English flood alert:

```bash
echo "+94771234567" > lists/demo.txt   # your verified number
npm run demo                           # dry run: shows the one number and the TwiML
npm run demo -- --live --yes           # rings your phone
npm run report -- logs/calls-<time>.jsonl
```

On a trial account the call starts with a Twilio notice. Press any key and the alert plays. Each demo call uses about $0.29 of trial credit.

## Calling a list

Put the numbers in `lists/` (git ignores it). Use one number per line, or a CSV with the number in any column. Accepted formats: `0771234567`, `771234567`, `94771234567`, `+94 77 123 4567`, and landlines like `011 234 5678`. Header rows are ignored, duplicates are removed, and invalid rows are listed so you can fix them.

```bash
# 1. Dry run (default): who would be called and the most it can cost. Nobody is called.
node broadcast-calls.js lists/kudawewa.csv --audio https://your-host/flood-si.mp3 --exclude-registered

# 2. Test on a few numbers first (put your own number at the top of the list)
node broadcast-calls.js lists/kudawewa.csv --audio https://your-host/flood-si.mp3 --limit 3 --live

# 3. Everyone
node broadcast-calls.js lists/kudawewa.csv --audio https://your-host/flood-si.mp3 --exclude-registered --live
```

`--live` asks you to type `yes` after showing the count and maximum cost. Run `node broadcast-calls.js --help` for every option.

### The message

- **`--audio <https URL>`** plays a recording. Use this for Sinhala and Tamil: Twilio's text-to-speech cannot speak Sinhala. The file must be at a public `https://` URL. Twilio Assets (Console → Functions and Assets) works, as does any public file host.
- **`--say "<text>"`** reads text out, with `--lang` (default `en-US`).
- **`--repeat 2`** plays it twice in the same call. This helps people who pick up late, but it doubles the talk time.

### Who gets called

- **`--exclude-registered`** skips numbers already in the `farmers` table. It reads the database settings from `api/config.env`, and the API's packages must be installed (`cd api && npm install`).
- **`--limit <n>`** calls only the first n numbers.
- **`--resume <log>`** skips numbers that already got a call in an earlier run. Use it after a stop or a crash so nobody is called twice. Numbers whose call failed to start are tried again.

### Pacing and stopping

Calls start one per second, Twilio's default limit for an account. Change it with `--calls-per-second` only if Twilio has raised your limit. 1,000 numbers take about 17 minutes.

Press Ctrl+C once to stop after the current call. The script prints the `--resume` command to carry on later. If Twilio rejects the credentials, the caller number, the trial or the Sri Lanka permission, the run stops at the first failure instead of trying every number.

Every call is written to `logs/calls-<time>.jsonl` (git ignores it): the number, the Twilio call SID, or the error.

## What it cost

Calls finish and get priced a few minutes after they are placed. Then run:

```bash
node call-report.js logs/calls-20261028-091500.jsonl
node call-report.js logs/calls-20261028-091500.jsonl --unanswered lists/retry.txt
```

The report looks each call up in Twilio and shows how many were answered, not answered, busy or failed, the average call length, and the total spent. `--unanswered` writes the no-answer and busy numbers to a file, ready for a second round.

## Cost

Twilio charges for calls to Sri Lanka per started minute, only for calls that are answered (a voicemail counts as answered):

| | Per minute |
|---|---|
| Mobile | $0.2886 |
| Landline | $0.3524 |

Rates are from twilio.com/en-us/voice/pricing/lk (October 2026). Update `RATE_PER_MINUTE` in `phones.js` if they change.

Calls hang up after 60 seconds by default (`--max-seconds`), so no answered call can bill more than 1 minute. The dry run's "most this can cost" assumes everyone answers. Real bills are lower because unanswered and busy calls are free. Keep the recording under 60 seconds, including repeats: 61 seconds costs the same as 2 minutes. Text-to-speech (`--say`) may add a small separate charge.

## Files

```
broadcast-calls.js   build the call list, estimate cost, place calls, write the log
call-report.js       actual outcomes and spend for a log, from Twilio
phones.js            Sri Lankan number parsing, list reading, call rates
make-call.js         single hard-coded test call
test/                node:test tests for phones.js (npm test)
```
