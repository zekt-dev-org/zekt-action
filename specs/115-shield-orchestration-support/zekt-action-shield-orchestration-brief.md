# zekt-action: Shield Encryption for Orchestration Payloads — Implementation Brief

**For:** The AI agent / developer working in the `zekt-dev-org/zekt-action` repository  
**Relates to:** Spec 114 (Shield hybrid encryption) and Spec 113 (orchestration)  
**Status:** Ready for implementation  
**Date:** 2026-09-01

---

## 0. Summary

`shield: true` currently has no effect when `orchestrate: true` — the orchestration path
returns early before the Shield block in `main.ts` is ever reached, and `orchestrate.ts`
has no knowledge of Shield. This spec describes the minimum changes needed to extend the
existing Shield behaviour to the orchestration path with zero new inputs and identical
UX to the standard path.

**Requirement:** a user who sets `shield: true` must get end-to-end encrypted payloads
whether `orchestrate` is `false` (existing) or `true` (new). The behaviour, inputs, and
error messages should be indistinguishable from the caller's perspective.

---

## 1. Background — What Is Already Working

The crypto layer (spec 114) is complete and reusable:

| Symbol | File | Status |
|---|---|---|
| `encryptPayload(payload, consumerKeys)` | `src/shield.ts` | ✅ Generic — accepts any `unknown`, returns `ShieldEnvelope` |
| `getConsumerKeys(apiUrl, oidcToken, repo)` | `src/shield.ts` | ✅ Generic — no path-specific coupling |
| `ShieldEnvelope` type | `src/types.ts` | ✅ Defined |
| `inputs.shield` | `src/utils.ts` → `ActionInputs` | ✅ Parsed and available in `runOrchestration` call site |
| OIDC token + repository string | `src/main.ts` | ✅ Already in scope when `runOrchestration` is called |

Nothing in `shield.ts` needs to change.

---

## 2. Identified Blockers (Structural Problems)

Three concrete issues prevent a straight wire-up today.

### 2.1 — `SubmitOrchestrationRequest` Has No Envelope Field

`EventRequest` accepts a `ShieldEnvelope` via the loosely typed `payload: unknown | ShieldEnvelope`
field. The orchestration equivalent has no equivalent slot:

```ts
// Current — no place for an envelope
export interface SubmitOrchestrationRequest {
  workflow_run_id: number;
  execution_mode: string;
  default_service_owner?: string;
  services: OrchestrationStep[];
}
```

A new optional field must be added so a Shield envelope can be carried alongside the
unencrypted metadata the backend needs for routing (`workflow_run_id`, `execution_mode`,
`default_service_owner`).

### 2.2 — Split Base URLs

Shield key retrieval calls `getConsumerKeys(inputs.zektApiUrl, ...)`.  
Orchestration submission calls `submitOrchestration(inputs.orchestrationApiUrl, ...)`.

These two inputs have **different production defaults**:

| Input | Default |
|---|---|
| `zekt-api-url` | `https://fxdevzektapp.azurewebsites.net` |
| `orchestration-api-url` | `https://www.zekt.dev` |

The `/api/shield/keys` endpoint lives on the orchestration host (`https://www.zekt.dev`),
not the legacy event host. Calling `getConsumerKeys` with `inputs.zektApiUrl` from within
`runOrchestration` would hit the wrong host. The Shield key fetch must use
`inputs.orchestrationApiUrl` when called from the orchestration path.

### 2.3 — Encryption Granularity

For the standard path the entire `payload` blob is encrypted as one unit. For
orchestration there are two candidate models:

| Option | What is encrypted | Trade-offs |
|---|---|---|
| **A — Whole-services envelope** | The entire `services` array serialised to JSON | One AES pass, one RSA wrap per consumer. Backend cannot inspect step metadata without decrypting. |
| **B — Per-step input envelopes** | Each `step.input` individually | Backend retains full routing metadata in plaintext. Multiplies RSA wraps by `n_steps × n_consumers`. |

**Recommended: Option A (whole-services envelope).**  
Matches the behaviour of the standard path exactly (one envelope for the whole payload),
keeps the action-side code simple, and is the only approach consistent with the stated
requirement that Shield works "exactly the same way" regardless of mode. The backend
already knows how to handle a `ShieldEnvelope`; it receives the envelope and defers
decryption to the consumer. Step routing metadata (`workflow_run_id`, `execution_mode`,
`default_service_owner`) travels outside the envelope in plaintext — the backend never
needed to decrypt those to route a request anyway.

---

## 3. Required Changes

### 3.1 `src/types.ts` — Add encrypted_services to SubmitOrchestrationRequest

```ts
export interface SubmitOrchestrationRequest {
  workflow_run_id: number;
  execution_mode: string;
  default_service_owner?: string;
  // Exactly one of services / encrypted_services is present.
  services?: OrchestrationStep[];
  encrypted_services?: ShieldEnvelope;
}
```

`services` becomes optional so the type is valid when only `encrypted_services` is
present. The backend must treat the absence of `services` as "payload is shielded —
see encrypted_services".

### 3.2 `src/orchestrate.ts` — Encrypt services array when shield is enabled

`runOrchestration` receives `inputs: ActionInputs` which already carries `inputs.shield`.
Add a Shield block between payload validation and request construction:

```
1. Parse + validate orchestration payload  (existing)
2. If inputs.shield:
     a. getConsumerKeys(inputs.orchestrationApiUrl, oidcToken, repository)
     b. encryptPayload(orchestrationPayload.services, consumerKeys)  → ShieldEnvelope
     c. Build SubmitOrchestrationRequest with encrypted_services; omit services.
   Else:
     Build SubmitOrchestrationRequest with services as today.
3. Submit  (existing)
```

Error handling (zero keys, bad PEM, wrap failure) is identical to the standard path —
`getConsumerKeys` and `encryptPayload` already throw descriptive errors.

Import additions required in `orchestrate.ts`:
```ts
import { getConsumerKeys, encryptPayload } from './shield';
```

### 3.3 `src/main.ts` — Pass shield flag through; no logic change needed

`runOrchestration(inputs, oidcToken)` already receives `inputs` which contains
`inputs.shield`. No change to `main.ts` is required — the existing early-return path
is correct; Shield logic moves into `runOrchestration` itself.

### 3.4 Backend contract (out of scope for this action)

The Zekt backend `/api/orchestration/submit` handler must be updated to:

- Accept `encrypted_services: ShieldEnvelope` as an alternative to `services`.
- Store/forward the envelope to consumers without attempting to inspect step contents.
- Return the same `{ execution_id }` response shape — no action-side change to response
  handling.

This backend change is a prerequisite. The action-side changes in 3.1–3.2 can be
implemented and merged behind the existing `shield: false` default with no behavioural
change until the backend is ready.

---

## 4. Logging and Job Summary

The standard path logs:

```
🛡️ Shield encryption enabled
📋 Retrieved N consumer keys
✅ Payload encrypted successfully
```

The orchestration path must emit identical messages. No new log lines are needed.

The existing `writeOrchestrationSummary` in `orchestrate.ts` does not currently show
Shield status. A `Shield` row should be added mirroring what `writeJobSummary` in
`main.ts` does for the standard path:

```ts
['Shield', inputs.shield ? '🛡️ Enabled' : 'Disabled'],
```

---

## 5. Testing

Extend `__tests__/orchestration-step-ref.test.ts` or add a sibling file covering:

| Case | Expected outcome |
|---|---|
| `orchestrate: true`, `shield: false` | `services` populated, `encrypted_services` absent, `getConsumerKeys` not called |
| `orchestrate: true`, `shield: true`, keys returned | `encrypted_services` is a valid `ShieldEnvelope`, `services` absent |
| `orchestrate: true`, `shield: true`, zero keys returned | Throws with same message as standard path |
| `orchestrate: true`, `shield: true`, bad PEM | Throws descriptive error |

---

## 6. Non-Goals

- No new action inputs — `shield: true` is the only control, identical to the standard path.
- No per-step granularity (Option B from section 2.3) — out of scope.
- No changes to the Shield key management UI or `/api/shield/keys` endpoint.
- No changes to consumer-side decryption — the envelope format is unchanged.
