// Sinhala speech from Dialog's SinhalaVITS (https://huggingface.co/dialoglk, MPL-2.0), through its free
// public demo, so nothing has to be installed. The demo sleeps when unused: the first request can take a minute.
// Audio is saved in audio/ and reused for the same text and voice, so the dry run's file is what gets played.
//
//   node sinhala-tts.js "<Sinhala text>" [--voice female1|female2|male1|male2]
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const SPACE_API = "https://dialoglk-sinhalavits.hf.space/gradio_api";
const AUDIO_DIR = path.join(__dirname, "audio");
const TIMEOUT_MS = 3 * 60 * 1000;

const VOICES = {
  female1: "Female Voice 1",
  female2: "Female Voice 2",
  male1: "Male Voice 1",
  male2: "Male Voice 2",
};

// The demo answers as server-sent events; the last "complete" or "error" event is the result
function parseGradioEvents(stream) {
  let result = null;
  for (const block of stream.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event: *(.+)$/m)?.[1].trim();
    const data = block.match(/^data: *(.*)$/m)?.[1];
    if (event === "complete") result = { ok: true, data: JSON.parse(data) };
    else if (event === "error") result = { ok: false, message: data && data !== "null" ? JSON.parse(data) : null };
  }
  return result;
}

// Length of a PCM WAV file, from its fmt and data chunks
function wavSeconds(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let byteRate = null;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    if (id === "fmt ") byteRate = buffer.readUInt32LE(at + 16);
    if (id === "data" && byteRate) return Math.min(size, buffer.length - at - 8) / byteRate;
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no audio data.");
}

function audioFileFor(text, voice) {
  const hash = crypto.createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 12);
  return path.join(AUDIO_DIR, `si-${voice}-${hash}.wav`);
}

async function sinhalaSpeech(text, voice) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let stream;
  try {
    const start = await fetch(`${SPACE_API}/call/generate_speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [text, VOICES[voice]] }),
      signal,
    });
    if (!start.ok) throw new Error(`HTTP ${start.status}`);
    const { event_id: eventId } = await start.json();
    stream = await (await fetch(`${SPACE_API}/call/generate_speech/${eventId}`, { signal })).text();
  } catch (err) {
    throw new Error(`Dialog's SinhalaVITS demo did not answer (${err.message}). Try again in a minute, or use --audio with a recording.`);
  }

  const result = parseGradioEvents(stream);
  if (!result?.ok) throw new Error(`SinhalaVITS could not read the text${result?.message ? `: ${result.message}` : "."}`);
  const audio = await fetch(result.data[0].url, { signal });
  if (!audio.ok) throw new Error(`Could not download the audio from SinhalaVITS (HTTP ${audio.status}).`);
  return Buffer.from(await audio.arrayBuffer());
}

// The audio file for this text and voice, made once and then reused
async function sinhalaAudioFile(text, voice = "female1") {
  if (!VOICES[voice]) throw new Error(`Unknown voice "${voice}". Use one of: ${Object.keys(VOICES).join(", ")}.`);
  const file = audioFileFor(text, voice);
  if (!fs.existsSync(file)) {
    const wav = await sinhalaSpeech(text, voice);
    wavSeconds(wav); // throws if the demo sent back something else
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    fs.writeFileSync(file, wav);
  }
  return { file, seconds: wavSeconds(fs.readFileSync(file)) };
}

module.exports = { VOICES, parseGradioEvents, wavSeconds, audioFileFor, sinhalaAudioFile };

if (require.main === module) {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: { voice: { type: "string", default: "female1" } },
  });
  const text = positionals.join(" ").trim();
  if (!text) {
    console.log('Usage: node sinhala-tts.js "<Sinhala text>" [--voice female1|female2|male1|male2]');
    process.exit(1);
  }
  console.log(`Making Sinhala audio (${VOICES[opts.voice] || opts.voice})… the first request can take a minute.`);
  sinhalaAudioFile(text, opts.voice)
    .then(({ file, seconds }) => console.log(`✅ ${path.relative(process.cwd(), file)} (${seconds.toFixed(1)}s). Open it to listen.`))
    .catch(err => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
