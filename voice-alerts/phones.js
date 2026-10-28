const fs = require("node:fs");

// Twilio outbound rates to Sri Lanka, USD per minute, billed per started minute
// (twilio.com/en-us/voice/pricing/lk, checked Oct 2026)
const RATE_PER_MINUTE = { mobile: 0.2886, landline: 0.3524 };

// 94 + 7X + 7 digits, same mobile prefixes as api/services/smsService.js
const MOBILE = /^947[01245678]\d{7}$/;
// 94 + area code (never starting 0 or 7) + rest, 9 digits after 94
const LANDLINE = /^94[1-689]\d{8}$/;

// Accepts 0771234567, 771234567, 94771234567, +94 77 123 4567 and landlines like 011 234 5678 or +94112345678.
// Returns { e164: "+94771234567", kind: "mobile" | "landline" } or null.
function normalizePhone(raw) {
  let digits = String(raw ?? "").trim().replace(/[\s\-+().]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("0")) digits = "94" + digits.slice(1);
  // 771234567 with the 0 dropped; mobiles only, so a 9-digit ID column is not mistaken for a landline
  else if (digits.length === 9 && digits.startsWith("7")) digits = "94" + digits;

  if (MOBILE.test(digits)) return { e164: "+" + digits, kind: "mobile" };
  if (LANDLINE.test(digits)) return { e164: "+" + digits, kind: "landline" };
  return null;
}

// One number per line, or a CSV/TSV where the number is in any column.
// Lines without digits (headers, blanks) are ignored; lines with digits but no
// valid number are reported as invalid so they can be fixed.
function readNumberList(file) {
  const numbers = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!/\d/.test(line)) continue;
    const phone = line.split(/[,;\t]/).map(normalizePhone).find(Boolean);
    if (!phone) invalid.push(line.trim());
    else if (seen.has(phone.e164)) duplicates++;
    else {
      seen.add(phone.e164);
      numbers.push(phone);
    }
  }

  return { numbers, invalid, duplicates };
}

module.exports = { RATE_PER_MINUTE, normalizePhone, readNumberList };
