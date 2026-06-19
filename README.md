# RiskScan — Implementation Readiness Scanner

RiskScan analyzes implementation plans, onboarding notes, rollout requirements, and operational-readiness documents for conditions that can delay delivery, block launch, weaken adoption, or leave critical work without accountable ownership.

> Fictional implementation case study. Included organizations, people, data, metrics, and outcomes are simulated for portfolio demonstration purposes.

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
├── config.json
├── package.json
├── server.js
├── lib/
│   ├── scoring.js
│   └── validation.js
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
    ├── run-tests.js                 # Core deterministic and API suite
    └── run-reviewer-tests.js        # Reviewer override/import suite
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

Configure the provider on the server, not in browser code:

```bash
ANALYSIS_PROVIDER=gemini
GEMINI_API_KEY=<server-side value>
GEMINI_MODEL=<supported model identifier>
node server.js
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
