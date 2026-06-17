# RiskScan — Implementation Readiness Scanner

An implementation advisory web application that ingests discovery notes, meeting transcripts, or rollout requirements, analyzes them for operational risks, and calculates an evidence-backed readiness score.

> *Disclaimer: Fictional implementation case study. All organizations, people, locations, data, metrics, and outcomes shown in this project are simulated for portfolio demonstration purposes.*

---

## Features

- **Ingestion & Presets**: Ingests custom text or runs pre-loaded scenarios (CRM Synchronization, AI Support Agent, Location Standardization) to evaluate readiness.
- **Structured Risk Registry**: Maps risks across 10 operational categories (stakeholder conflict, missing ownership, undefined metrics, data/configuration dependencies, adoption risks, compliance risks, etc.).
- **Calculated Scoring & Gates**:
  - Automatically calculates penalty deductions based on risk severity, unconfirmed ownership, metric gaps, unresolved stakeholder conflicts, and missing dependencies.
  - Implements strict **Readiness Score Blocker Gates**:
    - Score is capped at **49** (High implementation risk) if any unresolved critical risk involves compliance or lacks an owner.
    - Score is capped at **69** (Significant preparation required) if any other unresolved critical risk exists.
  - Supports residual accepted risk calculations (exactly `0.5` penalty multiplier for low-severity accepted items) and stable dependency deduplication.
- **Dynamic Provider Badging**: Connects to the backend server to determine the active analysis provider (fixtures vs live model structured output).
- **W3C Accessibility**: Fully compliant keyboard navigation (horizontal tablist shifting, Space/Enter manual panel activation) and ARIA announcers for dynamic status updates.
- **Responsive Print Layout**: Formats a professional executive advisory memo complete with print-optimized styles.

---

## Project Structure

```text
├── LICENSE                 # Apache 2.0 License
├── README.md               # Project documentation
├── config.json             # Configuration file containing score weights and rules
├── package.json            # Scripts, metadata, and dependencies
├── server.js               # Node.js http server, exports createAppServer programmatically
├── lib/
│   ├── scoring.js          # Shared scoring and blocker-gate logic (UMD module)
│   └── validation.js       # Shared strict schema validation logic (UMD module)
├── public/
│   ├── app.js              # Frontend UI orchestration, keyboard tabs, and event handlers
│   ├── index.html          # Main HTML structure with semantic elements and W3C landmarks
│   └── styles.css          # Core CSS variables, typography, focus states, and print layout
└── tests/
    ├── fixtures/           # Deterministic fixture scenarios (JSON format)
    └── run-tests.js        # Self-contained integration test suite
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (runs on standard Node.js, no external runtime required)

### Installation

Clone the repository and install dependencies (this project uses vanilla modules and has zero external npm dependencies for local execution):

```bash
npm install
```

### Running the Application

To start the local web server:

```bash
npm start
```

By default, the server runs at `http://localhost:3050`. Open this URL in your web browser.

#### Alternative Development Environment
If you are developing inside an Antigravity sandbox without global Node.js on the path, you can run the optional development command:
```bash
agy-node.cmd server.js
```

---

## Configuration & Environment Variables

You can configure the application behavior and active analysis modes via the following environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3050` | Port for the web server |
| `ANALYSIS_PROVIDER` | `demo` | The active provider: `demo`, `gemini`, or `antigravity` |
| `GEMINI_API_KEY` | *(empty)* | API key to communicate with the Gemini API (for Phase 2) |
| `GEMINI_MODEL` | `gemini-3.5-flash` | The Gemini model identifier to send requests to |
| `ANALYSIS_TIMEOUT_MS` | `60000` | Analysis process timeout in milliseconds |
| `MAX_FILE_BYTES` | `5242880` | Maximum file upload limit in bytes |
| `MAX_SOURCE_TEXT_BYTES` | `750000` | Maximum allowed characters in the raw input textarea |

---

## Running the Tests

To run the self-contained unit and API integration tests:

```bash
npm test
```

This runs the test suite (`tests/run-tests.js`), which:
1. Validates the JSON schema validation rules.
2. Checks scoring and penalty maths (including low-severity `0.5` residual penalties, dependency deduplication, and score gating).
3. Spins up the application server programmatically on a dynamic free port to run live HTTP assertions.
4. Safely closes the server programmatically.

---

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.
