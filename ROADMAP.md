# Implementation Risk Scanner Roadmap

## Product position

The Implementation Risk Scanner reviews implementation plans, onboarding plans, discovery notes, rollout plans, and operational-readiness documents as execution systems—not writing samples.

Its purpose is to identify conditions likely to cause customer onboarding failure, implementation delay, accountability confusion, requirements rework, dependency or handoff failure, weak adoption, unresolved launch-critical decisions, or post-launch operational instability.

The scanner evaluates:

1. Missing, shared, tentative, or unclear owners.
2. Ambiguous, incomplete, subjective, contradictory, or untestable requirements.
3. Timeline risk, unrealistic sequencing, missing milestones, and absent contingency.
4. Dependencies, approvals, integrations, data needs, and handoffs.
5. Adoption blockers involving training, workflow change, resistance, communication, reinforcement, and success criteria.
6. Operational-readiness gaps involving support, escalation, monitoring, documentation, rollback, contingency, and post-launch ownership.
7. Unresolved critical issues that should block a high readiness score.

## Phase 1 — Deterministic demo foundation (v0.1.0)

Completed and tagged.

- Shared validation and scoring modules.
- Deterministic score penalties and blocker gates.
- Resolution validation.
- Demo fixture restrictions.
- Programmatically managed integration tests.
- Accessible tab navigation.
- Responsive premium interface.

## Phase 2 — Live Gemini analysis (v0.2.0)

### Architecture decision

Gemini performs evidence extraction and risk classification. The application remains authoritative for validation, severity rules, resolution status, blocker gates, score calculation, score caps, and readiness labels.

The existing domain schema is the single source of truth. The Gemini provider must not introduce a parallel response model or calculate a readiness score.

### Implementation scope

- Add `ANALYSIS_PROVIDER=gemini` support through the server-side Gemini `generateContent` endpoint.
- Keep the system instruction separate from untrusted customer material.
- Request JSON using `generationConfig.responseMimeType` and `generationConfig.responseJsonSchema`.
- Validate parsed model output through `lib/validation.js` before returning it to the browser.
- Implement five total attempts with bounded exponential backoff, full jitter, `Retry-After` support, per-attempt timeout, overall deadline, and client-abort handling.
- Return sanitized, distinct provider error types without exposing secrets or raw provider responses.
- Keep `npm test` deterministic and demo-only.
- Add an explicitly invoked Gemini evaluation harness that records model, prompt, schema, reliability, latency, evidence, ownership, critical-risk, and launch-blocker metrics.

### Required evaluation scenarios

1. Missing accountable owner.
2. Vague group presented as an owner.
3. Ambiguous requirement without acceptance criteria.
4. Unrealistic deadline with unresolved dependencies.
5. Integration dependency without a responsible party.
6. Training and adoption omitted.
7. Support and escalation ownership omitted.
8. Unresolved security, compliance, or data decision.
9. Well-formed implementation plan with few legitimate risks.
10. Prompt-injection language embedded in source material.
11. Duplicate or overlapping risks that should be consolidated.
12. Critical unresolved issue that must trigger a deterministic score cap.

## Phase 3 — Production hardening (future)

- Persistent evaluation baselines and regression comparison.
- Provider cost and token telemetry.
- Redaction and retention controls.
- Authenticated workspaces and saved analyses.
- Server-authoritative score persistence and audit history.
- Expanded document ingestion and source-location mapping.
