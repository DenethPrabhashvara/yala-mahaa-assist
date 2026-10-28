// Look up what the calls in a broadcast log actually did and cost, from Twilio's own records.
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const twilio = require("twilio");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env: credentials can come from the shell instead
}

const USAGE = `
Usage:
  node call-report.js <LOG FILE> [--unanswered <FILE>]

  --unanswered <FILE>   Also write the numbers that did not pick up (no answer or busy)
                        to FILE, one per line, ready for another broadcast-calls.js run
`;

// Twilio statuses that mean the call has not finished yet
const STILL_RUNNING = new Set(["queued", "initiated", "ringing", "in-progress"]);

// Run fn over items with at most `limit` requests in flight
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      unanswered: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (opts.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY and TWILIO_API_SECRET in voice-alerts/.env.");
  }
  const client = twilio(TWILIO_API_KEY, TWILIO_API_SECRET, { accountSid: TWILIO_ACCOUNT_SID });

  const entries = fs.readFileSync(positionals[0], "utf8")
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  const placed = entries.filter(entry => entry.sid);
  const notPlaced = entries.length - placed.length;

  console.log(`Looking up ${placed.length} calls…`);
  const calls = await mapLimit(placed, 5, async entry => {
    try {
      const call = await client.calls(entry.sid).fetch();
      return {
        to: entry.to,
        status: call.status,
        seconds: Number(call.duration) || 0,
        // Twilio reports charges as negative numbers, and null until the call is priced
        price: call.price === null ? null : Math.abs(Number(call.price)),
        unit: call.priceUnit,
      };
    } catch (err) {
      return { to: entry.to, status: "lookup-failed", error: err.message };
    }
  });

  const byStatus = {};
  for (const call of calls) byStatus[call.status] = (byStatus[call.status] || 0) + 1;
  const priced = calls.filter(call => call.price !== null && call.price !== undefined);
  const total = priced.reduce((sum, call) => sum + call.price, 0);
  const unit = priced[0]?.unit || "USD";
  const answered = calls.filter(call => call.status === "completed");
  const talkSeconds = answered.reduce((sum, call) => sum + call.seconds, 0);
  const running = calls.filter(call => STILL_RUNNING.has(call.status)).length;
  const unpriced = calls.filter(call => call.status === "completed" && call.price === null).length;

  console.log(`\nCalls placed:     ${placed.length}`);
  if (notPlaced) console.log(`Failed to start:  ${notPlaced} (not charged)`);
  for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(15)} ${n}`);
  }
  if (answered.length) {
    console.log(`Answered:         ${answered.length} (${Math.round((answered.length / placed.length) * 100)}%), average ${Math.round(talkSeconds / answered.length)}s`);
  }
  console.log(`\nSpent so far:     ${total.toFixed(4)} ${unit}`);
  if (running || unpriced) {
    console.log(`⏳ ${running} calls still running and ${unpriced} not priced yet. Run this again in a few minutes for the final total.`);
  }
  console.log("Text-to-speech (--say) may add a small charge that Twilio bills separately from these call prices.");

  for (const call of calls.filter(call => call.status === "lookup-failed").slice(0, 5)) {
    console.log(`Could not look up ${call.to}: ${call.error}`);
  }

  if (opts.unanswered) {
    const numbers = calls.filter(call => call.status === "no-answer" || call.status === "busy").map(call => call.to);
    fs.writeFileSync(opts.unanswered, numbers.join("\n") + (numbers.length ? "\n" : ""));
    console.log(`\nWrote ${numbers.length} unanswered numbers to ${opts.unanswered}`);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
