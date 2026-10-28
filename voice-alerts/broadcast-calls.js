// Phone a voice alert to every number in a list through Twilio.
// Dry run by default: shows who would be called and the most it can cost. Add --live to place the calls.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { parseArgs } = require("node:util");
const twilio = require("twilio");
const { RATE_PER_MINUTE, normalizePhone, readNumberList } = require("./phones.js");
const { VOICES, audioFileFor, sinhalaAudioFile } = require("./sinhala-tts.js");
const { publishAudio } = require("./twilio-assets.js");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env: credentials can come from the shell instead
}

const USAGE = `
Usage:
  node broadcast-calls.js <NUMBERS FILE> (--audio <URL> | --say "<TEXT>" | --say-si "<TEXT>") [options]

Message (pick one):
  --audio <https URL>       Recorded MP3/WAV to play, e.g. for Tamil
  --say "<text>"            Text read out by Twilio's voice (not Sinhala)
  --lang <code>             Voice language for --say (default en-US)
  --say-si "<text>"         Sinhala text, spoken by Dialog's SinhalaVITS. The dry run saves the
                            audio in audio/ to listen to; --live uploads it to Twilio Assets.
  --voice <name>            Voice for --say-si: female1 (default), female2, male1, male2
  --repeat <n>              Play the message n times in one call (default 1)

Who to call:
  --exclude-registered      Skip numbers already in the farmers table (they get SMS)
  --resume <log file>       Skip numbers already called in an earlier run, and keep logging there
  --limit <n>               Only the first n numbers, e.g. a small test batch

Cost and pacing:
  --max-seconds <n>         Hang up after n seconds (default 60, so at most 1 billed minute)
  --ring-seconds <n>        Give up if nobody answers within n seconds (default 30)
  --calls-per-second <n>    Pace of new calls (default 1, Twilio's default limit)

  --live                    Actually place the calls (otherwise dry run)
  --yes                     Skip the "type yes" confirmation

Examples:
  node broadcast-calls.js lists/kudawewa.csv --audio https://example.com/flood-si.mp3 --exclude-registered
  node broadcast-calls.js lists/kudawewa.csv --say-si "කුඩාවැව ජලාශය පිරී ඇත." --exclude-registered
`;

const BAD_CREDENTIALS = "Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID, TWILIO_API_KEY and TWILIO_API_SECRET in .env.";

// Twilio errors that will fail the same way for every remaining number
const FATAL_ERRORS = {
  20003: BAD_CREDENTIALS,
  70051: BAD_CREDENTIALS,
  21210: "TWILIO_FROM_NUMBER is not a voice number on this Twilio account.",
  21215: "Calls to Sri Lanka are blocked. Turn on Sri Lanka in Twilio Console → Voice → Settings → Geo permissions.",
  21219: "Trial accounts can only call verified numbers. Add it in Twilio Console → Phone Numbers → Verified Caller IDs, or upgrade the account.",
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const usd = amount => `$${amount.toFixed(2)}`;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a whole number of 1 or more.`);
  return n;
}

function buildTwiml({ audio, say, lang, repeat }) {
  const response = new twilio.twiml.VoiceResponse();
  if (audio) response.play({ loop: repeat }, audio);
  else response.say({ language: lang, loop: repeat }, say);
  return response.toString();
}

async function loadRegisteredNumbers() {
  try {
    process.loadEnvFile(path.join(__dirname, "..", "api", "config.env"));
  } catch {
    // Fall back to whatever DB settings are already in the environment
  }
  const db = require("../api/config/db.js");
  try {
    const result = await db.query("SELECT phone FROM farmers");
    return new Set(result.rows.map(row => normalizePhone(row.phone)?.e164).filter(Boolean));
  } finally {
    await db.pool.end();
  }
}

// Numbers that already have a call SID in the log; failed attempts are tried again
function readCalledNumbers(logFile) {
  const called = new Set();
  for (const line of fs.readFileSync(logFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.sid) called.add(entry.to);
  }
  return called;
}

function newLogFile() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  fs.mkdirSync(path.join(__dirname, "logs"), { recursive: true });
  return path.join(__dirname, "logs", `calls-${stamp}.jsonl`);
}

async function main() {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      audio: { type: "string" },
      say: { type: "string" },
      lang: { type: "string", default: "en-US" },
      "say-si": { type: "string" },
      voice: { type: "string", default: "female1" },
      repeat: { type: "string", default: "1" },
      "exclude-registered": { type: "boolean", default: false },
      resume: { type: "string" },
      limit: { type: "string" },
      "max-seconds": { type: "string", default: "60" },
      "ring-seconds": { type: "string", default: "30" },
      "calls-per-second": { type: "string", default: "1" },
      live: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (opts.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  const listFile = positionals[0];
  if (!fs.existsSync(listFile)) fail(`Numbers file not found: ${listFile}`);
  const messages = [opts.audio, opts.say, opts["say-si"]].filter(value => value !== undefined);
  if (messages.length !== 1) fail("Give one message: --audio <URL>, --say \"<text>\" or --say-si \"<Sinhala text>\".");
  if (opts.audio && !/^https:\/\//.test(opts.audio)) fail("--audio must be a public https:// URL so Twilio can fetch it.");
  if (opts.say !== undefined && !opts.say.trim()) fail("--say text is empty.");
  if (opts["say-si"] !== undefined && !opts["say-si"].trim()) fail("--say-si text is empty.");
  if (!VOICES[opts.voice]) fail(`--voice must be one of: ${Object.keys(VOICES).join(", ")}.`);
  if (opts.resume && !fs.existsSync(opts.resume)) fail(`Log to resume not found: ${opts.resume}`);

  const repeat = positiveInt(opts.repeat, "repeat");
  const maxSeconds = positiveInt(opts["max-seconds"], "max-seconds");
  const ringSeconds = positiveInt(opts["ring-seconds"], "ring-seconds");
  const callsPerSecond = Number(opts["calls-per-second"]);
  if (!(callsPerSecond > 0)) fail("--calls-per-second must be more than 0.");
  const message = { audio: opts.audio, say: opts.say?.trim(), lang: opts.lang, repeat };

  // Build the call queue
  const list = readNumberList(listFile);
  let queue = list.numbers;
  let registeredSkipped = 0;
  let alreadyCalled = 0;

  if (opts["exclude-registered"]) {
    let registered;
    try {
      registered = await loadRegisteredNumbers();
    } catch (err) {
      fail(`Could not read registered farmers from the database: ${err.message}`);
    }
    const before = queue.length;
    queue = queue.filter(phone => !registered.has(phone.e164));
    registeredSkipped = before - queue.length;
  }
  if (opts.resume) {
    const called = readCalledNumbers(opts.resume);
    const before = queue.length;
    queue = queue.filter(phone => !called.has(phone.e164));
    alreadyCalled = before - queue.length;
  }
  if (opts.limit) queue = queue.slice(0, positiveInt(opts.limit, "limit"));

  // Worst case: every call is answered and runs until --max-seconds cuts it off
  const counts = { mobile: 0, landline: 0 };
  for (const phone of queue) counts[phone.kind]++;
  const billedMinutes = Math.ceil(maxSeconds / 60);
  const perCall = kind => RATE_PER_MINUTE[kind] * billedMinutes;
  const maxCost = counts.mobile * perCall("mobile") + counts.landline * perCall("landline");

  console.log(`\nNumbers file:        ${listFile}`);
  console.log(`Valid numbers:       ${list.numbers.length}`);
  if (list.duplicates) console.log(`Duplicates removed:  ${list.duplicates}`);
  if (list.invalid.length) {
    console.log(`Invalid, skipped:    ${list.invalid.length}`);
    for (const line of list.invalid.slice(0, 5)) console.log(`                     ${line}`);
    if (list.invalid.length > 5) console.log(`                     …and ${list.invalid.length - 5} more`);
  }
  if (opts["exclude-registered"]) console.log(`Registered, skipped: ${registeredSkipped}`);
  if (opts.resume) console.log(`Already called:      ${alreadyCalled}`);
  console.log(`To call:             ${queue.length} (${counts.mobile} mobile, ${counts.landline} landline)`);
  console.log(`\nEach call rings for up to ${ringSeconds}s and hangs up after ${maxSeconds}s.`);
  console.log(`Most this can cost:  ${usd(maxCost)} (every call answered, ${billedMinutes} billed minute${billedMinutes === 1 ? "" : "s"} each)`);
  console.log(`Unanswered and busy calls are free. Expect less than this.`);
  console.log(`At ${callsPerSecond} call/s this takes about ${Math.ceil(queue.length / callsPerSecond / 60)} min to place.`);

  if (!queue.length) {
    console.log("\nNobody to call.");
    return;
  }

  let speech = null;
  if (opts["say-si"]) {
    const text = opts["say-si"].trim();
    if (!fs.existsSync(audioFileFor(text, opts.voice))) {
      console.log(`\nMaking the Sinhala audio with SinhalaVITS (${VOICES[opts.voice]})… the first request can take a minute.`);
    }
    try {
      speech = await sinhalaAudioFile(text, opts.voice);
    } catch (err) {
      fail(err.message);
    }
    console.log(`Sinhala audio:       ${path.relative(process.cwd(), speech.file)} (${speech.seconds.toFixed(1)}s). Listen to it before going live.`);
    const seconds = Math.ceil(speech.seconds * repeat);
    if (seconds > maxSeconds) console.log(`⚠️  The message lasts ${seconds}s, so it will be cut off. Shorten it or raise --max-seconds.`);
  } else if (opts.say) {
    // About 150 spoken words a minute
    const seconds = Math.ceil((opts.say.trim().split(/\s+/).length / 2.5) * repeat);
    if (seconds > maxSeconds) console.log(`⚠️  The message takes about ${seconds}s to read out, so it will be cut off. Shorten it or raise --max-seconds.`);
  } else {
    console.log(`Make sure the recording (×${repeat}) is shorter than ${maxSeconds}s, or it will be cut off.`);
  }
  console.log(`\nTwiML: ${buildTwiml(speech ? { ...message, audio: "<Twilio Assets URL, uploaded with --live>" } : message)}`);
  if (!opts.live) {
    console.log("\n🧪 Dry run: no calls placed. Add --live to call these numbers.");
    return;
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_FROM_NUMBER) {
    fail("Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET and TWILIO_FROM_NUMBER in voice-alerts/.env.");
  }

  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nCall ${queue.length} numbers now, up to ${usd(maxCost)}? Type "yes" to start: `);
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Cancelled. Nobody was called.");
      return;
    }
  }

  const client = twilio(TWILIO_API_KEY, TWILIO_API_SECRET, { accountSid: TWILIO_ACCOUNT_SID });
  if (speech) {
    console.log("\nUploading the Sinhala audio to Twilio Assets…");
    try {
      message.audio = await publishAudio(client, speech.file, { apiKey: TWILIO_API_KEY, apiSecret: TWILIO_API_SECRET });
    } catch (err) {
      fail(`${err.status === 401 ? BAD_CREDENTIALS : err.message} Nobody was called.`);
    }
    console.log(`Audio URL:           ${message.audio}`);
  }
  const twiml = buildTwiml(message);
  const logFile = opts.resume || newLogFile();
  const log = entry => fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
  const gapMs = 1000 / callsPerSecond;

  // First Ctrl+C finishes the current call request and stops; the log keeps what was done
  let stopReason = null;
  process.on("SIGINT", () => {
    if (stopReason) process.exit(130);
    stopReason = "Stopped with Ctrl+C.";
    console.log("\nStopping after this call…");
  });

  console.log(`\n📞 Calling ${queue.length} numbers. Log: ${logFile}\n`);
  let placed = 0;
  let failed = 0;

  for (const [i, phone] of queue.entries()) {
    if (stopReason) break;
    const started = Date.now();
    const at = new Date().toISOString();
    const progress = `[${i + 1}/${queue.length}]`;

    try {
      const call = await client.calls.create({
        to: phone.e164,
        from: TWILIO_FROM_NUMBER,
        twiml,
        timeout: ringSeconds,
        timeLimit: maxSeconds,
      });
      log({ to: phone.e164, kind: phone.kind, sid: call.sid, at });
      placed++;
      console.log(`${progress} ${phone.e164} ✓ ${call.sid}`);
    } catch (err) {
      log({ to: phone.e164, kind: phone.kind, error: err.message, code: err.code ?? null, at });
      failed++;
      console.log(`${progress} ${phone.e164} ✗ ${err.message}`);
      const fatal = FATAL_ERRORS[err.code] || (err.status === 401 ? BAD_CREDENTIALS : null);
      if (fatal) stopReason = fatal;
    }

    await sleep(Math.max(0, gapMs - (Date.now() - started)));
  }

  console.log(`\nPlaced ${placed} calls, ${failed} failed to start.`);
  if (stopReason) {
    console.log(`⛔ ${stopReason}`);
    console.log(`To carry on later without calling anyone twice, run the same command with --resume ${logFile}`);
  }
  if (placed) console.log(`\nIn a few minutes, check who answered and what it cost:\n  node call-report.js ${logFile}`);
}

main().catch(err => fail(err.message));
