// Puts an audio file on Twilio Assets, so calls can <Play> it from a public https:// URL.
// Uses one Serverless service ("yala-maha-voice-alerts"); each upload deploys only that file,
// so the previous upload's URL stops working.
const fs = require("node:fs");
const path = require("node:path");

const SERVICE_NAME = "yala-maha-voice-alerts";
const ENVIRONMENT_NAME = "alerts";
const UPLOAD_URL = "https://serverless-upload.twilio.com/v1";
const BUILD_TIMEOUT_MS = 3 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function findOrCreateService(client) {
  const services = await client.serverless.v1.services.list();
  return (
    services.find(s => s.uniqueName === SERVICE_NAME) ||
    client.serverless.v1.services.create({
      uniqueName: SERVICE_NAME,
      friendlyName: "Yala-Maha voice alerts",
      includeCredentials: false,
    })
  );
}

async function findOrCreateEnvironment(service) {
  const environments = await service.environments.list();
  return (
    environments.find(e => e.uniqueName === ENVIRONMENT_NAME) ||
    service.environments.create({ uniqueName: ENVIRONMENT_NAME, domainSuffix: ENVIRONMENT_NAME })
  );
}

async function uploadVersion(serviceSid, assetSid, file, { apiKey, apiSecret }) {
  const form = new FormData();
  form.append("Path", `/${path.basename(file)}`);
  form.append("Visibility", "public");
  form.append("Content", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
  const response = await fetch(`${UPLOAD_URL}/Services/${serviceSid}/Assets/${assetSid}/Versions`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio Assets upload failed: ${body.message || `HTTP ${response.status}`}`);
  return body.sid;
}

async function waitForBuild(service, buildSid) {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const build = await service.builds(buildSid).fetch();
    if (build.status === "completed") return;
    if (build.status === "failed") throw new Error("Twilio Assets build failed. See Twilio Console → Functions and Assets.");
    await sleep(2000);
  }
  throw new Error("Twilio Assets build took too long. See Twilio Console → Functions and Assets.");
}

// Twilio needs the URL to answer before it can play it (twil.io refuses HEAD, so this is a GET)
async function waitUntilServed(url) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(url).catch(() => null);
    await response?.body?.cancel();
    if (response?.ok && /^audio\//.test(response.headers.get("content-type") || "")) return;
    await sleep(2000);
  }
  throw new Error(`The audio was deployed but ${url} does not answer yet. Try again in a minute.`);
}

// Uploads `file` and returns its public URL
async function publishAudio(client, file, credentials) {
  const serviceSid = (await findOrCreateService(client)).sid;
  const service = client.serverless.v1.services(serviceSid);
  const environment = await findOrCreateEnvironment(service);

  const name = path.basename(file);
  const assets = await service.assets.list();
  const asset = assets.find(a => a.friendlyName === name) || (await service.assets.create({ friendlyName: name }));
  const versionSid = await uploadVersion(serviceSid, asset.sid, file, credentials);

  const build = await service.builds.create({ assetVersions: [versionSid] });
  await waitForBuild(service, build.sid);
  await service.environments(environment.sid).deployments.create({ buildSid: build.sid });

  const url = `https://${environment.domainName}/${name}`;
  await waitUntilServed(url);
  return url;
}

module.exports = { publishAudio };
