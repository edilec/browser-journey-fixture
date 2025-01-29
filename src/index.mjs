export const TOOL_ID = 'browser-journey-fixture';
export const LIMITS = Object.freeze({ bytes: 1_048_576, journeys: 50, steps: 100, depth: 7, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({
  'input-unreadable': 'error', 'input-invalid': 'error', 'duplicate-key': 'error', 'byte-limit': 'error', 'journey-limit': 'error', 'step-limit': 'error', 'depth-limit': 'error', 'time-limit': 'error', 'export-incomplete': 'error', 'journey-invalid': 'error', 'trace-invalid': 'error', 'evidence-missing': 'error', 'identity-ambiguous': 'error', 'no-steps': 'error',
  'checkpoint-mismatch': 'error', 'step-mismatch': 'error', 'setup-mismatch': 'error', 'external-navigation': 'error'
});
const UNKNOWN = new Set(['input-unreadable', 'input-invalid', 'duplicate-key', 'byte-limit', 'journey-limit', 'step-limit', 'depth-limit', 'time-limit', 'export-incomplete', 'journey-invalid', 'trace-invalid', 'evidence-missing', 'identity-ambiguous', 'no-steps']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(v);
const route = v => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && v.length <= 256 && !/[\\\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(v);
const scalar = v => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
function stateValid(value) { return object(value) && Object.entries(value).every(([key, item]) => id(key) && scalar(item)); }
function sameState(a, b) { const ka = Object.keys(a).sort(order), kb = Object.keys(b).sort(order); return ka.length === kb.length && ka.every((key, i) => key === kb[i] && a[key] === b[key]); }
const missingState = (expected, actual) => Object.keys(expected).some(key => !Object.hasOwn(actual, key));
function finding(ruleId, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: {
    'checkpoint-mismatch': 'The exported checkpoint differs from the declared expectation.',
    'step-mismatch': 'The exported step selector or action differs from the declaration.',
    'setup-mismatch': 'The exported journey setup differs from the declared isolated state.',
    'external-navigation': 'The exported trace navigated outside the local route space.'
  }[ruleId] ?? 'Journey evidence cannot be evaluated safely.', location: { file: '@export', pointer } };
}
function report(findings, results = []) {
  findings.sort((a, b) => order(a.location.file, b.location.file) || order(a.location.pointer, b.location.pointer) || order(a.ruleId, b.ruleId));
  return { schemaVersion: '1', tool: TOOL_ID, status: findings.some(f => UNKNOWN.has(f.ruleId)) ? 'incomplete' : findings.length ? 'fail' : 'pass', summary: { checked: results.length, errors: findings.length, warnings: 0 }, results, findings };
}
export const incomplete = ruleId => report([finding(ruleId)]);
export function parseStrictJson(raw) {
  const value = JSON.parse(raw); let i = 0;
  const space = () => { while (/\s/u.test(raw[i] ?? '')) i++; };
  const token = () => { const start = i++; while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue; } if (raw[i++] === '"') return JSON.parse(raw.slice(start, i)); } throw new Error('input-invalid'); };
  const walk = depth => { if (depth > LIMITS.depth) throw new Error('depth-limit'); space(); if (raw[i] === '{') { i++; space(); const keys = new Set(); while (raw[i] !== '}') { const key = token(); if (keys.has(key)) throw new Error('duplicate-key'); keys.add(key); space(); i++; walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '[') { i++; space(); while (raw[i] !== ']') { walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '"') { token(); return; } while (i < raw.length && !/[\s,}\]]/u.test(raw[i])) i++; };
  walk(0); return value;
}
function tooDeep(v, depth = 0) { return depth > LIMITS.depth || (v !== null && typeof v === 'object' && Object.values(v).some(child => tooDeep(child, depth + 1))); }
function validExpected(e) {
  return object(e) && route(e.route) && stateValid(e.state) && (e.screenshotSha256 === undefined || typeof e.screenshotSha256 === 'string' && /^[a-f0-9]{64}$/u.test(e.screenshotSha256)) && Object.keys(e).every(k => ['route', 'state', 'screenshotSha256'].includes(k));
}
function validStep(s) { return object(s) && id(s.id) && id(s.selector) && ['click', 'type', 'submit', 'navigate'].includes(s.action) && validExpected(s.expected) && Object.keys(s).every(k => ['id', 'selector', 'action', 'expected'].includes(k)); }
function validTraceStep(s) {
  return object(s) && id(s.stepId) && id(s.selector) && ['click', 'type', 'submit', 'navigate'].includes(s.action) && typeof s.route === 'string' && s.route.length <= 256 && stateValid(s.state) && (s.screenshotSha256 === undefined || typeof s.screenshotSha256 === 'string' && /^[a-f0-9]{64}$/u.test(s.screenshotSha256)) && Object.keys(s).every(k => ['stepId', 'selector', 'action', 'route', 'state', 'screenshotSha256'].includes(k));
}
export function validateJourneys(document, { now = Date.now } = {}) {
  const start = now(), expired = () => now() - start > LIMITS.milliseconds;
  if (!object(document)) return incomplete('input-invalid');
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(document)); } catch { return incomplete('input-invalid'); }
  if (bytes > LIMITS.bytes) return incomplete('byte-limit');
  if (tooDeep(document)) return incomplete('depth-limit');
  if (expired()) return incomplete('time-limit');
  if (document.schemaVersion !== '1' || !Array.isArray(document.journeys) || !Array.isArray(document.traces) || Object.keys(document).some(k => !['schemaVersion', 'complete', 'journeys', 'traces', 'note'].includes(k)) || (document.note !== undefined && typeof document.note !== 'string')) return incomplete('input-invalid');
  if (document.complete !== true) return incomplete('export-incomplete');
  if (document.journeys.length > LIMITS.journeys || document.traces.length > LIMITS.journeys) return incomplete('journey-limit');
  if (!document.journeys.length) return incomplete('no-steps');
  const declared = new Set(), traces = new Map();
  for (const [i, journey] of document.journeys.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!object(journey) || !id(journey.id) || !stateValid(journey.initialState) || !Array.isArray(journey.steps) || Object.keys(journey).some(k => !['id', 'initialState', 'steps'].includes(k))) return report([finding('journey-invalid', `/journeys/${i}`)]);
    if (declared.has(journey.id)) return report([finding('identity-ambiguous', `/journeys/${i}`)]);
    declared.add(journey.id);
    if (journey.steps.length > LIMITS.steps) return incomplete('step-limit');
    if (!journey.steps.length) return report([finding('no-steps', `/journeys/${i}/steps`)]);
    const ids = new Set();
    for (const [j, step] of journey.steps.entries()) {
      if (!validStep(step)) return report([finding('journey-invalid', `/journeys/${i}/steps/${j}`)]);
      if (ids.has(step.id)) return report([finding('identity-ambiguous', `/journeys/${i}/steps/${j}`)]);
      ids.add(step.id);
    }
  }
  for (const [i, trace] of document.traces.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!object(trace) || !id(trace.journeyId) || !stateValid(trace.initialState) || !Array.isArray(trace.steps) || Object.keys(trace).some(k => !['journeyId', 'complete', 'initialState', 'steps'].includes(k))) return report([finding('trace-invalid', `/traces/${i}`)]);
    if (trace.complete !== true) return incomplete('export-incomplete');
    if (traces.has(trace.journeyId)) return report([finding('identity-ambiguous', `/traces/${i}`)]);
    if (trace.steps.length > LIMITS.steps) return incomplete('step-limit');
    for (const [j, step] of trace.steps.entries()) if (!validTraceStep(step)) return report([finding('trace-invalid', `/traces/${i}/steps/${j}`)]);
    traces.set(trace.journeyId, trace);
  }
  if (traces.size !== declared.size || [...traces.keys()].some(key => !declared.has(key))) return incomplete('evidence-missing');
  const findings = [], results = [];
  for (const [i, journey] of document.journeys.entries()) {
    if (expired()) return incomplete('time-limit');
    const trace = traces.get(journey.id);
    if (trace.steps.length !== journey.steps.length) return report([finding('evidence-missing', `/journeys/${i}/steps`)]);
    if (missingState(journey.initialState, trace.initialState)) return report([finding('evidence-missing', `/journeys/${i}/initialState`)]);
    if (!sameState(journey.initialState, trace.initialState)) findings.push(finding('setup-mismatch', `/journeys/${i}/initialState`));
    for (const [j, step] of journey.steps.entries()) {
      if (expired()) return incomplete('time-limit');
      const actual = trace.steps[j], pointer = `/journeys/${i}/steps/${j}`;
      if (actual.stepId !== step.id) return report([finding('evidence-missing', pointer)]);
      if (missingState(step.expected.state, actual.state) || (step.expected.screenshotSha256 !== undefined && actual.screenshotSha256 === undefined)) return report([finding('evidence-missing', pointer)]);
      const before = findings.length;
      if (actual.selector !== step.selector || actual.action !== step.action) findings.push(finding('step-mismatch', pointer));
      if (!route(actual.route)) findings.push(finding('external-navigation', pointer));
      else if (actual.route !== step.expected.route || !sameState(actual.state, step.expected.state) || (step.expected.screenshotSha256 !== undefined && actual.screenshotSha256 !== step.expected.screenshotSha256)) findings.push(finding('checkpoint-mismatch', pointer));
      results.push({ journeyOrdinal: i, stepOrdinal: j, state: findings.length === before ? 'matched' : 'failed' });
    }
  }
  if (expired()) return incomplete('time-limit');
  return report(findings, results);
}
