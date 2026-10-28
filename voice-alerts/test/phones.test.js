const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizePhone, readNumberList } = require("../phones.js");

test("mobile numbers in every common format become +94 numbers", () => {
  for (const raw of ["0771234567", "771234567", "94771234567", "+94 77 123 4567", "077-123-4567", "(077) 123 4567"]) {
    assert.deepEqual(normalizePhone(raw), { e164: "+94771234567", kind: "mobile" }, raw);
  }
});

test("landlines are accepted and priced as landlines", () => {
  assert.deepEqual(normalizePhone("011 234 5678"), { e164: "+94112345678", kind: "landline" });
  assert.deepEqual(normalizePhone("+94252223456"), { e164: "+94252223456", kind: "landline" });
});

test("non-numbers, wrong lengths, unused mobile prefixes and bare 9-digit IDs are rejected", () => {
  for (const raw of ["", "abc", "077123456", "07712345678", "0731234567", "123456789", "200012345678", "123456789V", "+447700900123"]) {
    assert.equal(normalizePhone(raw), null, raw);
  }
});

test("lists skip headers, find the number in any column, and report duplicates and bad rows", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-alerts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "numbers.csv");
  fs.writeFileSync(file, [
    "name,village,phone",
    "Kamal,Kudawewa,077 123 4567",
    "Nimal,Palugaswewa,0712345678",
    "Kamal again,Kudawewa,+94771234567",
    "Bad,Horabora,07712",
    "",
    "0252223456",
  ].join("\r\n"));

  const list = readNumberList(file);
  assert.deepEqual(list.numbers.map(phone => phone.e164), ["+94771234567", "+94712345678", "+94252223456"]);
  assert.equal(list.duplicates, 1);
  assert.deepEqual(list.invalid, ["Bad,Horabora,07712"]);
});
