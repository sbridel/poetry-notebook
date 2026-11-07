const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { group, test, assertEqual, assertTrue } = require('./framework');

// Automatic CMUdict download (requestUrl mocked): validated before writing.
module.exports = function testsCmudict(m) {
  const real = fs.readFileSync(path.join(__dirname, '..', 'cmudict.dict'));
  const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const makeApp = (written) => ({ vault: { configDir: '.obsidian', adapter: { write: async (p, t) => { written[p] = t.length; } } } });

  group('CMUdict download', () => {
    test('pinned release URL', () => {
      assertTrue(/^https:\/\/github\.com\/sbridel\/poetry-notebook\/releases\/download\/[\d.]+\/cmudict\.dict\.gz$/.test(m.CMUDICT_URL), m.CMUDICT_URL);
    });
    test('valid gzip: indexed, then written to the plugin folder', async () => {
      const written = {};
      globalThis.__fakeRequest = async () => ({ status: 200, arrayBuffer: toArrayBuffer(zlib.gzipSync(real)) });
      const r = await m.downloadCmudict(makeApp(written), { id: 'poetry-notebook' });
      assertTrue(r.index.size > 100000, String(r.index.size));
      assertTrue(written['.obsidian/plugins/poetry-notebook/cmudict.dict'] > 1000000, 'written');
    });
    test('truncated file: rejected, nothing written', async () => {
      const written = {};
      globalThis.__fakeRequest = async () => ({ status: 200, arrayBuffer: toArrayBuffer(zlib.gzipSync(real.subarray(0, 5000))) });
      let threw = false;
      try { await m.downloadCmudict(makeApp(written), { id: 'poetry-notebook' }); } catch (e) { threw = true; }
      assertTrue(threw, 'throws');
      assertEqual(Object.keys(written).length, 0);
    });
    test('HTTP error: rejected', async () => {
      globalThis.__fakeRequest = async () => ({ status: 404 });
      let threw = false;
      try { await m.downloadCmudict(makeApp({}), { id: 'poetry-notebook' }); } catch (e) { threw = true; }
      assertTrue(threw);
    });
  });
};
