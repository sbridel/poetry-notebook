// ============================================================
// Vault file discovery (mirrors the French plugin's search order,
// since BRAT only syncs main.js/manifest.json/styles.css)
// ============================================================
async function findAndReadVaultFile(app, manifest, filenames, overridePath) {
  const configDir = app.vault.configDir;
  const candidates = [];
  if (overridePath) candidates.push(overridePath);
  for (const name of filenames) {
    candidates.push(`${configDir}/plugins/${manifest.id}/${name}`);
    candidates.push(`${configDir}/${name}`);
    candidates.push(name); // vault root
  }
  for (const path of candidates) {
    try {
      if (await app.vault.adapter.exists(path)) {
        return await app.vault.adapter.read(path);
      }
    } catch (e) { /* try next candidate */ }
  }
  // last resort: recursive search anywhere in the vault
  const files = app.vault.getFiles();
  for (const name of filenames) {
    const match = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (match) {
      try { return await app.vault.read(match); } catch (e) { /* ignore */ }
    }
  }
  return null;
}

// Same search order as findAndReadVaultFile, but also returns the resolved
// path — needed for the personal dictionary, which the plugin writes back to.
async function findVaultFileWithPath(app, manifest, filenames, overridePath) {
  const configDir = app.vault.configDir;
  const candidates = [];
  if (overridePath) candidates.push(overridePath);
  for (const name of filenames) {
    candidates.push(`${configDir}/plugins/${manifest.id}/${name}`);
    candidates.push(`${configDir}/${name}`);
    candidates.push(name);
  }
  for (const path of candidates) {
    try {
      if (await app.vault.adapter.exists(path)) {
        return { path, text: await app.vault.adapter.read(path) };
      }
    } catch (e) { /* try next candidate */ }
  }
  const files = app.vault.getFiles();
  for (const name of filenames) {
    const match = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (match) {
      try { return { path: match.path, text: await app.vault.read(match) }; } catch (e) { /* ignore */ }
    }
  }
  return null;
}


// ------------------------------------------------------------
// CMUdict automatic download (like the French plugin's base dictionary):
// when no cmudict.dict is found in the vault, the plugin fetches the
// gzipped copy attached to its own GitHub release (CMUdict is public
// domain), checks it, and saves it in the plugin folder. Disclosed in the
// README; one attempt per session, never blocking the plugin's start-up.
// ------------------------------------------------------------
const CMUDICT_RELEASE = '1.5.0'; // release whose cmudict.dict.gz is used; change only if CMUdict changes
const CMUDICT_URL = `https://github.com/sbridel/poetry-notebook/releases/download/${CMUDICT_RELEASE}/cmudict.dict.gz`;

async function gunzipToText(bytes) {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  const zlib = require('zlib'); // desktop (Electron) fallback if the web API is missing
  return zlib.gunzipSync(Buffer.from(bytes)).toString('utf-8');
}

// Downloads, validates (decompresses and indexes, at least 100k words)
// BEFORE writing, so a broken download never replaces anything.
// Returns { text, index } or throws.
async function downloadCmudict(app, manifest) {
  const res = await requestUrl({ url: CMUDICT_URL, throw: false });
  if (!res || res.status !== 200 || !res.arrayBuffer) throw new Error(`HTTP ${res && res.status}`);
  const text = await gunzipToText(res.arrayBuffer);
  const index = buildCmudictIndex(text);
  if (!index || index.size < 100000) throw new Error('unexpected CMUdict file');
  await app.vault.adapter.write(`${app.vault.configDir}/plugins/${manifest.id}/cmudict.dict`, text);
  return { text, index };
}
