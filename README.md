# Browser Journey Fixture

`browser-journey-fixture` validates a declared browser journey against an **already exported local trace**. Despite its name, it never opens a browser, runs a step, navigates, submits data, or fetches a URL. This scope adapts the catalog's journey-runner wording to the house read-only reporter contract. Node.js 22+; zero dependencies.

## Quick start

```sh
node bin/browser-journey-fixture.mjs --root examples --input passing.json
node bin/browser-journey-fixture.mjs --root examples --input failing.json
npm run check
```

The passing example exits `0`; the failing example exits `1` with an exact journey/step pointer. Bad CLI configuration exits `2` with empty stdout. Unreadable, partial, malformed, or missing evidence exits `2` with an `incomplete` JSON report. Stdout otherwise contains exactly one JSON report. The real input file must stay within the real `--root`, including through symlinks.

## Export format

```json
{
  "schemaVersion": "1",
  "complete": true,
  "journeys": [{
    "id": "synthetic-a",
    "initialState": { "session": "alpha" },
    "steps": [{ "id": "open", "selector": "open-button", "action": "click", "expected": { "route": "/form", "state": { "session": "alpha" } } }]
  }],
  "traces": [{
    "journeyId": "synthetic-a",
    "complete": true,
    "initialState": { "session": "alpha" },
    "steps": [{ "stepId": "open", "selector": "open-button", "action": "click", "route": "/form", "state": { "session": "alpha" } }]
  }]
}
```

IDs and selectors are stable opaque keys from the fixture producer, not executable CSS or scripts. Actions are labels only: `click`, `type`, `submit`, or `navigate`. Each journey matches a trace by `journeyId`, so trace array order and parallel synthetic journeys do not share setup state. Within a journey, step order, selector, action, route, and exact state snapshot are checked. A declared `expected.screenshotSha256` optionally checks an exported trace digest; the tool does not open screenshot bytes. Required missing state keys or digests are incomplete. Actual divergent values or routes are failures. Declared routes must be local absolute paths beginning with one `/`; external expected navigation is invalid. A captured external/protocol-relative route is an evaluated `external-navigation` failure. No allowlist enables real navigation. Optional top-level string `note` is ignored.

## Rule catalog and report

| Rule | Severity | Status / exit |
| --- | --- | --- |
| `checkpoint-mismatch`, `step-mismatch`, `setup-mismatch`, `external-navigation` | error | fail / `1` |
| `input-unreadable`, `input-invalid`, `duplicate-key`, `byte-limit`, `journey-limit`, `step-limit`, `depth-limit`, `time-limit`, `export-incomplete`, `journey-invalid`, `trace-invalid`, `evidence-missing`, `identity-ambiguous`, `no-steps` | error | incomplete / `2` |

The v1 report contains `results` with zero-based journey/step ordinals and matched/failed state, plus sorted findings. Findings use logical source role `@export` and JSON pointers into the exact input file; raw selectors, routes, state values, and screenshot hashes never appear. Findings sort by UTF-16 code-unit `(location.file, location.pointer, ruleId)`.

## Limits and non-goals

Strict UTF-8; maximum 1,048,576 bytes, 50 journeys/traces, 100 steps per journey/trace, JSON depth 7 (root 0), and 5,000 ms injected processing time. IDs and selector keys are 1–128 code units; local routes at most 256. Screenshots are optional 64-character lowercase SHA-256 digests. Exact N and N+1 tests cover the primary bounds. Duplicate JSON keys, including escaped spellings, and unknown fields are refused.

This tool does not prove a real browser performed the actions or that a screenshot matches its claimed digest. It trusts the local trace producer and reports mismatches in that export only. It makes no network calls and writes no artifacts.
