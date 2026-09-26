import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateJourneys, LIMITS, parseStrictJson } from '../src/index.mjs';

const journey = (id = 'first', expected = 'ready') => ({ id, initialState: { session: expected }, steps: [
  { id: 'open', selector: 'open-button', action: 'click', expected: { route: '/form', state: { session: expected } } },
  { id: 'submit', selector: 'submit-button', action: 'submit', expected: { route: '/done', state: { session: expected }, screenshotSha256: 'a'.repeat(64) } }
] });
const trace = (id = 'first', actual = 'ready') => ({ journeyId: id, complete: true, initialState: { session: actual }, steps: [
  { stepId: 'open', selector: 'open-button', action: 'click', route: '/form', state: { session: actual } },
  { stepId: 'submit', selector: 'submit-button', action: 'submit', route: '/done', state: { session: actual }, screenshotSha256: 'a'.repeat(64) }
] });
const doc = (journeys = [journey()], traces = [trace()]) => ({ schemaVersion: '1', complete: true, journeys, traces });
const run = (root, input) => spawnSync(process.execPath, ['bin/browser-journey-fixture.mjs', '--root', root, '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--import=/Users/km/Desktop/web/open-source/migration-plan-template/support/deny-network.mjs' } });

test('good declared journey matches exported local trace checkpoints', () => {
  const r = validateJourneys(doc()); assert.equal(r.status, 'pass'); assert.equal(r.summary.checked, 2); assert.deepEqual(r.findings, []);
});
test('broken checkpoint reports exact journey and step ordinal', () => {
  const t = trace(); t.steps[1].route = '/error'; const r = validateJourneys(doc([journey()], [t]));
  assert.equal(r.status, 'fail'); assert.equal(r.findings[0].ruleId, 'checkpoint-mismatch'); assert.equal(r.findings[0].location.pointer, '/journeys/0/steps/1');
});
test('parallel journeys remain isolated by journey ID and initial state', () => {
  const r = validateJourneys(doc([journey('first', 'alpha'), journey('second', 'beta')], [trace('second', 'beta'), trace('first', 'alpha')]));
  assert.equal(r.status, 'pass'); assert.equal(r.summary.checked, 4);
  const wrong = validateJourneys(doc([journey('first', 'alpha'), journey('second', 'beta')], [trace('first', 'alpha'), trace('second', 'alpha')]));
  assert.equal(wrong.status, 'fail'); assert.equal(wrong.findings[0].location.pointer, '/journeys/1/initialState');
});
test('external navigation is blocked in observed trace, and forbidden in declaration', () => {
  const t = trace(); t.steps[0].route = 'https://external.invalid/'; const observed = validateJourneys(doc([journey()], [t]));
  assert.equal(observed.status, 'fail'); assert.equal(observed.findings[0].ruleId, 'external-navigation');
  const j = journey(); j.steps[0].expected.route = 'https://external.invalid/'; assert.equal(validateJourneys(doc([j])).status, 'incomplete');
});
test('partial, missing or duplicate trace evidence cannot pass', () => {
  assert.equal(validateJourneys({ ...doc(), complete: false }).status, 'incomplete');
  const t = trace(); t.complete = false; assert.equal(validateJourneys(doc([journey()], [t])).status, 'incomplete');
  assert.equal(validateJourneys(doc([journey()], [])).status, 'incomplete');
  assert.equal(validateJourneys(doc([journey()], [trace(), trace()])).status, 'incomplete');
  const missing = trace(); missing.steps.pop(); assert.equal(validateJourneys(doc([journey()], [missing])).status, 'incomplete');
});
test('missing required state or screenshot evidence is incomplete, not a policy failure', () => {
  const noImage = trace(); delete noImage.steps[1].screenshotSha256;
  assert.equal(validateJourneys(doc([journey()], [noImage])).status, 'incomplete');
  const noState = trace(); delete noState.steps[0].state.session;
  assert.equal(validateJourneys(doc([journey()], [noState])).status, 'incomplete');
  const noSetup = trace(); delete noSetup.initialState.session;
  assert.equal(validateJourneys(doc([journey()], [noSetup])).status, 'incomplete');
});
test('untrusted script instruction is rejected and never executed', () => {
  globalThis.__journeyCanary = 0; const r = validateJourneys({ ...doc(), script: 'globalThis.__journeyCanary=1' });
  assert.equal(r.status, 'incomplete'); assert.equal(globalThis.__journeyCanary, 0); delete globalThis.__journeyCanary;
});
test('journey, step, byte, depth and time bounds enforce N and N+1', () => {
  const manyJ = Array.from({ length: LIMITS.journeys }, (_, i) => journey(`j${i}`)); const manyT = Array.from({ length: LIMITS.journeys }, (_, i) => trace(`j${i}`));
  assert.equal(validateJourneys(doc(manyJ, manyT)).status, 'pass'); assert.equal(validateJourneys(doc(manyJ.concat(journey('extra')), manyT)).findings[0].ruleId, 'journey-limit');
  const j = journey(); const t = trace(); j.steps = Array.from({ length: LIMITS.steps }, (_, i) => ({ id: `s${i}`, selector: 'key', action: 'click', expected: { route: '/', state: {} } })); t.steps = j.steps.map(s => ({ stepId: s.id, selector: s.selector, action: s.action, route: '/', state: {} }));
  assert.equal(validateJourneys(doc([j], [t])).status, 'pass'); j.steps.push({ id: 'extra', selector: 'key', action: 'click', expected: { route: '/', state: {} } }); assert.equal(validateJourneys(doc([j], [t])).findings[0].ruleId, 'step-limit');
  const x = doc(); x.note = ''; const overhead = Buffer.byteLength(JSON.stringify(x)); x.note = 'x'.repeat(LIMITS.bytes - overhead); assert.equal(validateJourneys(x).status, 'pass'); x.note += 'x'; assert.equal(validateJourneys(x).findings[0].ruleId, 'byte-limit');
  const deep = doc(); assert.equal(validateJourneys(deep).status, 'pass'); deep.journeys[0].steps[0].expected.state.session = { nested: 'x' }; assert.equal(validateJourneys(deep).findings[0].ruleId, 'depth-limit');
  assert.equal(validateJourneys(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds : 0; })() }).status, 'pass'); assert.equal(validateJourneys(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds + 1 : 0; })() }).findings[0].ruleId, 'time-limit');
});
test('duplicate JSON keys including escaped spelling refused', () => assert.throws(() => parseStrictJson('{"complete":false,"complet\\u0065":true}'), /duplicate-key/));
test('CLI strict UTF-8, read confinement, invalid root and usage shapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-')); await writeFile(join(root, 'good.json'), JSON.stringify(doc())); assert.equal(run(root, 'good.json').status, 0);
  await writeFile(join(root, 'bad.json'), Buffer.from([0xff])); assert.equal(JSON.parse(run(root, 'bad.json').stdout).status, 'incomplete');
  await symlink(tmpdir(), join(root, 'escape')); assert.equal(JSON.parse(run(root, 'escape/no.json').stdout).status, 'incomplete');
  assert.equal(run(join(root, 'missing-root'), 'good.json').stdout, '');
  const usage = spawnSync(process.execPath, ['bin/browser-journey-fixture.mjs', '--root', root, '--input', 'good.json', '--bad'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(usage.status, 2); assert.equal(usage.stdout, '');
});
