# Implementation Risk Scanner — Customer Onboarding & Operational Readiness

### Role: Product Strategist, Implementation Risk Analyst & Full-Stack Prototype Builder

**AI-assisted implementation readiness scanner that identifies missing owners, unclear requirements, dependency risks, adoption gaps, and unresolved launch blockers before go-live.**

> Fictional implementation case study. Included organizations, people, data, metrics, and outcomes are simulated for portfolio demonstration purposes.

## Overview

Designed and built an implementation-risk and operational-readiness scanner for customer onboarding, rollout planning, and implementation review.

The system analyzes discovery notes, implementation plans, and readiness documents for conditions that can delay delivery, block launch, weaken adoption, or leave critical work without accountable ownership.

Gemini extracts evidence and suggests classifications, but the application remains authoritative. Independent validation and deterministic rules calculate severity, progression blockers, launch blockers, readiness scores, and score caps. The reviewer workflow then allows a human to adjust those determinations without erasing the calculated result.

Version 0.2.0 completed live Gemini analysis and passed all 12 evaluation scenarios along with the deterministic test suite. Phase 3 adds the human review, comparison, ownership, and export layer.

## Roadmap

### Phase 1 — Deterministic Foundation · Completed

- Independent validation and scoring
- Resolution-state requirements
- Readiness score caps for unresolved blockers
- Demo-provider restrictions
- Automated server and scoring tests
- Accessible keyboard navigation
- Production-quality interface redesign

### Phase 2 — Live Gemini Analysis · Completed

- Structured Gemini evidence extraction
- Fixed onboarding-risk taxonomy
- Condition-specific severity rules
- Deterministic progression and launch blockers
- Stable finding IDs and dependency remapping
- Retry, timeout, and provider-error handling
- Independent domain validation
- Twelve golden evaluation scenarios
- 12/12 live evaluation scenarios passed
- Version 0.2.0 tagged and released

### Phase 3 — Reviewer Workflow · In Review

- Drag-and-drop plan and registry intake
- Human severity and blocker decisions
- Owner assignment, target dates, and resolution notes
- Scan-to-scan risk comparison
- Versioned registry export and validated import
- Executive Markdown brief export
- Reviewer-aware print memorandum
- Dedicated reviewer regression tests and CI

## Current capabilities

### Deterministic analysis and scoring

- Evidence-backed risks use validated categories, condition codes, affected scope, and implementation stage.
- Model suggestions remain diagnostic inputs only; deterministic application rules calculate severity and blocker state.
- Active launch blockers cap readiness at **49**.
- Active progression blockers cap readiness at **69**.
- Resolved risks clear penalties and gates only after owner confirmation, a resolution note, and a valid resolution timestamp.

### Live and demo providers

- Deterministic fixture mode supports repeatable demonstrations and automated tests.
- Gemini mode accepts custom implementation material and returns structured JSON that is independently validated before use.
- Customer material remains separated from the fixed system instruction and is treated as untrusted content.
- Provider timeouts, condition-code constraints, and the live evaluation harness remain preserved from Phase 2.

### Phase 3 reviewer workflow

- Drag-and-drop intake for `.txt`, `.md`, and versioned RiskScan registry `.json` files.
- Human severity, launch-blocker, and progression-blocker decisions while preserving the calculated result for auditability.
- Tri-state blocker controls: calculated, force blocked, or force not blocked.
- Stakeholder-based owner assignment, custom owners, target dates, reviewer rationale, status, and resolution notes.
- Scan-to-scan comparison using stable permanent risk IDs with a deterministic fingerprint fallback.
- New, maintained, and removed/resolved risk summaries.
- Downloadable reviewer registry JSON and clipboard-ready executive Markdown briefs.
- Print output synchronized with owners, target dates, effective severity, blocker state, and reviewer rationale.

## Reviewer override policy

Reviewer decisions do not overwrite the underlying model evidence or deterministic calculation. Each risk can retain:

- `finalSeverity`: calculated application result
- `severityOverride`: optional reviewer severity decision
- `blocksLaunchOverride`: optional reviewer launch decision
- `blocksProgressionOverride`: optional reviewer progression decision
- `overrideReason` and `overrideUpdatedAt`: audit context

A valid resolution always clears blocker gates. Stale override fields cannot keep a fully resolved risk blocked.

## Registry import and export

Saved registries use a versioned envelope:

```json
{
  "exportFormat": "risk-scan-registry",
  "exportVersion": 1,
  "exportedAt": "2026-06-19T00:00:00.000Z",
  "projectName": "Example rollout",
  "analysisProfile": "general",
  "sourceText": "...",
  "result": {}
}
```

Imported JSON is rejected unless its format version is supported and its complete result passes the shared domain validator. Raw legacy analysis results can also be imported when they pass the same validation rules.

## Project structure

```text
├── .env.example
├── config.json
├── package.json
├── server.js
├── lib/
│   ├── analysis-schema.js
│   ├── scoring.js
│   ├── validation.js
│   └── providers/
│       └── gemini.js
├── public/
│   ├── app.js                       # Phase 3 loader
│   ├── app-core.js                  # Preserved Phase 2 application
│   ├── reviewer-workflow.js         # Reviewer interactions and exports
│   ├── reviewer-normalization-fix.js
│   ├── reviewer-workflow.css
│   ├── index.html
│   └── styles.css
└── tests/
    ├── fixtures/
    ├── reports/
    ├── run-tests.js                 # Core deterministic and API suite
    ├── run-reviewer-tests.js        # Reviewer override/import suite
    └── run-evaluation.js            # Live model-quality harness
```

## Run locally

Requires Node.js and no external runtime dependencies.

```bash
npm install
npm start
```

The default local address is `http://localhost:3050`.

### Demo mode

```bash
ANALYSIS_PROVIDER=demo npm start
```

Demo mode accepts the included deterministic scenarios. Editing a preset into arbitrary custom text requires a live provider; therefore, text-change comparison testing should use Gemini mode or two imported registry files.

### Gemini mode

Copy `.env.example` to `.env`, configure the provider on the server, and run the application. Never place provider credentials in browser code.

```text
ANALYSIS_PROVIDER=gemini
GEMINI_API_KEY=<server-side value>
GEMINI_MODEL=<supported model identifier>
```

The model-quality evaluation harness can be run with:

```bash
node tests/run-evaluation.js
```

## Tests

Run the complete Phase 3 test command:

```bash
npm test
```

This runs the reviewer workflow tests first, followed by the existing deterministic validation, scoring, stable-ID, and HTTP integration suite.

Individual suites are also available:

```bash
npm run test:reviewer
npm run test:core
```

The reviewer suite verifies severity overrides, explicit true and false blocker overrides, resolution behavior, reviewer-field validation, and versioned registry imports.

## Manual verification checklist

1. Drop a `.txt` or `.md` file and confirm the source textarea is populated.
2. Import an exported registry and confirm reviewer state, owners, target dates, and overrides are restored.
3. Apply and clear each tri-state override and confirm the score and cap recalculate immediately.
4. Run two live scans or import two registries and confirm new, maintained, and removed/resolved risks are summarized.
5. Download the registry and re-import it.
6. Copy the Markdown brief and verify its score, gate, owner, target-date, and action formatting.
7. Print the advisory memo and verify reviewer decisions appear without replacing calculated evidence.

## License

Apache License 2.0. See [LICENSE](LICENSE).
