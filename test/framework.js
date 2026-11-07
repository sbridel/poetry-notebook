// Minimal test framework, deliberately dependency-free (no jest/mocha to
// install) — same design as the French sibling plugin's: group assertions
// by theme, print a clear summary, exit non-zero if anything fails.

let currentGroup = null;
const results = [];
const pending = []; // async tests (fn returns a promise), awaited by summary()

function group(name, fn) {
  currentGroup = name;
  fn();
  currentGroup = null;
}

function test(description, fn) {
  const name = currentGroup ? `${currentGroup} — ${description}` : description;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(
        () => results.push({ name, ok: true }),
        (e) => results.push({ name, ok: false, error: e.message })));
      return;
    }
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) {
    throw new Error(`${context ? context + ' — ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(value, context) {
  if (!value) throw new Error(`${context ? context + ' — ' : ''}expected a truthy value, got ${JSON.stringify(value)}`);
}
function assertFalse(value, context) {
  if (value) throw new Error(`${context ? context + ' — ' : ''}expected a falsy value, got ${JSON.stringify(value)}`);
}

async function summary() {
  await Promise.all(pending);
  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} tests passed.\n`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((r) => console.log(`  ✗ ${r.name}\n    ${r.error}`));
    console.log('');
  }
  process.exitCode = failures.length > 0 ? 1 : 0;
}

module.exports = { group, test, assertEqual, assertTrue, assertFalse, summary };
