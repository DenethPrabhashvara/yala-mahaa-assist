const test = require("node:test");
const assert = require("node:assert/strict");
const { VOICES, parseGradioEvents, wavSeconds, audioFileFor } = require("../sinhala-tts.js");

// A mono 16-bit WAV with `samples` silent samples, optionally with an extra chunk before the audio
function wav(samples, rate = 22050, extraChunk = null) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16); // byte rate
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(samples * 2, 4);
  const body = Buffer.concat([fmt, ...(extraChunk ? [extraChunk] : []), dataHeader, Buffer.alloc(samples * 2)]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, body]);
}

test("WAV length comes from the byte rate and the data chunk", () => {
  assert.equal(wavSeconds(wav(22050 * 3)), 3);
  assert.equal(wavSeconds(wav(8000, 8000)), 1);
});

test("WAV chunks before the audio are skipped", () => {
  const list = Buffer.alloc(12);
  list.write("LIST", 0, "ascii");
  list.writeUInt32LE(4, 4);
  assert.equal(wavSeconds(wav(22050, 22050, list)), 1);
});

test("anything that is not a WAV file is rejected", () => {
  assert.throws(() => wavSeconds(Buffer.from("<html>Space is sleeping</html>")), /Not a WAV file/);
});

test("the demo's complete event gives the audio file", () => {
  const stream = 'event: generating\ndata: null\n\nevent: complete\ndata: [{"url": "https://x.hf.space/file=audio.wav"}]\n\n';
  assert.deepEqual(parseGradioEvents(stream), { ok: true, data: [{ url: "https://x.hf.space/file=audio.wav" }] });
});

test("the demo's error event is reported, with or without a message", () => {
  assert.deepEqual(parseGradioEvents('event: error\ndata: "Text is too long"\n\n'), { ok: false, message: "Text is too long" });
  assert.deepEqual(parseGradioEvents("event: error\ndata: null\n\n"), { ok: false, message: null });
  assert.equal(parseGradioEvents("event: heartbeat\ndata: null\n\n"), null);
});

test("the same text and voice always map to the same audio file", () => {
  const text = "කුඩාවැව ජලාශය පිරී ඇත.";
  assert.equal(audioFileFor(text, "female1"), audioFileFor(text, "female1"));
  assert.notEqual(audioFileFor(text, "female1"), audioFileFor(text, "male1"));
  assert.notEqual(audioFileFor(text, "female1"), audioFileFor(`${text} `, "female1"));
});

test("all four SinhalaVITS voices are offered", () => {
  assert.deepEqual(Object.keys(VOICES), ["female1", "female2", "male1", "male2"]);
});
