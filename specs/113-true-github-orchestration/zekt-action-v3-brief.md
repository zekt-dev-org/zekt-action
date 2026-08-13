# zekt-action v3 — Implementation Brief

**For:** The AI agent / developer working in the `zekt-dev-org/zekt-action` repository  
**Relates to:** Zekt spec 113 — True GitHub Workflow Orchestration  
**Status:** Ready for implementation  
**Date:** 2026-08-08

---

## 1. What Is This?

`zekt-action` is a GitHub Action that provider service workflows call to register their
workflow run with the Zekt backend and submit an output payload. This is currently v2.

**v3 adds orchestration support** — a new capability where a consumer workflow can submit
a multi-step service chain to the Zekt backend in a single action call, receive an
`execution_id`, and optionally wait for the entire chain to complete.

**The v2 code path must remain completely unchanged.** Orchestration is activated
exclusively by the `orchestrate: true` input. When `orchestrate` is omitted or `false`,
the action must behave identically to v2 with zero regressions.

---

## 2. The Discriminator: `orchestrate` (boolean)

Everything in v3 branches on a single input: `orchestrate`.

```
orchestrate: false (default)  →  existing v2 code path — no changes
orchestrate: true             →  new orchestration code path
```

This is the most important constraint in this brief. **Do not change any existing behavior
unless `orchestrate` is explicitly set to `true`.**

### Why this matters

- Existing service workflows (provider side) already call `zekt-action` with just
  `payload` and `event-type`. They must continue to work without modification.
- Consumer workflows that want orchestration opt in explicitly with `orchestrate: true`.
- The `payload` input has a **different required shape** depending on `orchestrate`:
  - `orchestrate: false` → `payload` is any arbitrary JSON object (unchanged)
  - `orchestrate: true` → `payload` must conform to the orchestration request schema
    (a `services` array — see Section 5)

---

## 3. Changes to `action.yml`

### 3.1 New inputs

```yaml
inputs:
  # --- existing inputs unchanged ---
  event-type:
    description: 'Event type for standard (non-orchestrated) dispatch'
    required: false
  payload:
    description: >
      Arbitrary JSON payload (orchestrate: false) OR orchestration plan object
      (orchestrate: true). See Section 5 for the required shape when orchestrate is true.
    required: false
    default: '{}'
  shield:
    description: 'Enable payload encryption (existing input, unchanged)'
    required: false
    default: 'false'

  # --- new inputs ---
  orchestrate:
    description: >
      When true, treat payload as a multi-step orchestration plan and POST to
      /api/orchestration/submit instead of /api/zekt/register-run.
      All orchestration-specific inputs (execution_mode, wait) are ignored
      when this is false or omitted.
    required: false
    default: 'false'

  execution_mode:
    description: >
      Execution strategy for the orchestration. Only evaluated when orchestrate: true.
      'sequential' (default) runs each step after the previous completes.
      'parallel' is reserved for a future release and will be rejected by the backend.
    required: false
    default: 'sequential'

  wait:
    description: >
      When true (and orchestrate: true), the action blocks after submitting the
      orchestration, polling GET /api/orchestration/{execution_id}/status every 30 seconds
      until the execution reaches a terminal state (completed, failed, timed_out).
      Step outputs are then written to GITHUB_OUTPUT. Use with caution — orchestrations
      can take many minutes. Default: false (fire-and-forget).
    required: false
    default: 'false'
```

### 3.2 New outputs

```yaml
outputs:
  execution_id:
    description: >
      Orchestration execution ID returned by the Zekt backend (e.g. exec-{uuid}).
      Only set when orchestrate: true. Use this to poll status or correlate
      the zekt-orchestration-result callback event.

  execution_status:
    description: >
      Terminal status of the orchestration: completed | failed | timed_out.
      Only set when orchestrate: true AND wait: true.
```

---

## 4. Code Path: `orchestrate: false` (Existing — Do Not Break)

The existing path calls `POST /api/zekt/register-run`. In v3, **one additive change** is
made to this path: if the action detects it is running inside a `repository_dispatch`-triggered
workflow, it reads `client_payload._zekt.orchestration` from the GitHub event file and
sends a flat `orchestration_step_ref` object in the request body.

**"Zero changes required" — scope:** This applies only to the `zekt-action` call at the
end of the provider workflow (output reporting). The action auto-detects `_zekt` context
automatically. It does **not** mean the provider workflow can continue reading its input
parameters from an arbitrary path — see Section 7 for what an orchestration-compatible
provider workflow looks like on the receive side.

### 4.1 EXACT wire format the backend requires

The backend `register-run` DTO (`RegisterRunOrchestrationRef`) expects a **flat,
snake_case** object:

```json
{
  "orchestration_step_ref": {
    "execution_id": "exec-abc123",
    "step_id": "create-sub"
  }
}
```

But Zekt dispatches the orchestration context inside `client_payload` as a **nested,
camelCase** structure:

```json
{
  "input": { ... },
  "_zekt": {
    "orchestration": {
      "executionId": "exec-abc123",
      "stepId": "create-sub",
      "requestorRepository": "dev-team-org/dev-repo"
    }
  }
}
```

The action **must** unwrap `_zekt.orchestration` and remap the two fields from camelCase
to snake_case. `requestorRepository` is not sent to `register-run`. Sending the raw
`_zekt` object verbatim will deserialize to a struct with empty `ExecutionId`/`StepId` and
the backend will silently skip orchestration linking — this is the exact bug that will
cause the step to remain stuck at `dispatching`.

### 4.2 Reference bash implementation

```bash
# Auto-detect orchestration context if triggered by repository_dispatch
ORCH_REF="null"
if [ "$GITHUB_EVENT_NAME" = "repository_dispatch" ]; then
  # Read _zekt.orchestration and remap camelCase → snake_case.
  # If the field is absent (non-orchestrated dispatch), ORCH_REF stays "null".
  ORCH_REF=$(jq -c '
    (.client_payload._zekt.orchestration // empty)
    | if . == null or . == "" then null
      else { execution_id: .executionId, step_id: .stepId }
      end
  ' "$GITHUB_EVENT_PATH")
  ORCH_REF="${ORCH_REF:-null}"
fi

# Build request body. Omit orchestration_step_ref entirely when null to keep the
# request minimal (the backend treats null and absent as equivalent).
REQUEST_BODY=$(jq -n \
  --arg run_id "$GITHUB_RUN_ID" \
  --argjson payload "$INPUT_PAYLOAD" \
  --argjson orch_ref "$ORCH_REF" \
  '{
    zekt_run_id: ($run_id | tonumber),
    zekt_step_id: "default",
    zekt_payload: $payload
  } + (if $orch_ref == null then {} else { orchestration_step_ref: $orch_ref } end)')

curl -sf -X POST "$ZEKT_API_BASE/api/zekt/register-run" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Repository: $GITHUB_REPOSITORY" \
  -d "$REQUEST_BODY"
```

### 4.3 Validation the action must perform

After extracting `_zekt.orchestration`, verify **both** `executionId` and `stepId` are
non-empty strings before constructing the ref. If either is missing/empty while the other
is present, log a warning and send `orchestration_step_ref: null` (do not send a partial
ref — the backend will accept it and then fail to advance the step).

```bash
# Optional defensive check inside the jq expression above
if [ "$ORCH_REF" != "null" ]; then
  EXEC_ID=$(echo "$ORCH_REF" | jq -r '.execution_id // empty')
  STEP_ID=$(echo "$ORCH_REF" | jq -r '.step_id // empty')
  if [ -z "$EXEC_ID" ] || [ -z "$STEP_ID" ]; then
    echo "::warning::_zekt.orchestration present but incomplete — dropping orchestration_step_ref"
    ORCH_REF="null"
  fi
fi
```

### 4.4 Backend behavior summary

- `orchestration_step_ref` **absent** or `null` → treated as non-orchestrated (existing v2
  behavior, backwards compatible).
- `orchestration_step_ref` **present with both fields** → backend calls
  `OrchestrationService.SetStepRunningAsync(execution_id, step_id, workflowRunId)`,
  which advances the step from `dispatching` → `running` and stores the workflow run ID.
  When `workflow_run.completed` later arrives, `WebhookReceiverFunction` looks up the
  correlation and calls `AdvanceAsync` to dispatch the next step.
- The `requestorRepository` field in `_zekt.orchestration` is informational only — the
  backend already has this via the execution document. Do not send it to `register-run`.

---

## 5. Code Path: `orchestrate: true` (New)

### 5.1 Payload schema

When `orchestrate: true`, the `payload` input **must** be a JSON object conforming to
this shape. The action should validate this before making any API call and fail with a
clear error if it does not match.

Each step targets a Zekt service by its immutable `service_slug` — a machine-readable
identifier the service owner registers in the Zekt Registry. The human-readable name
(`workflowName`) is never used for routing. Targets may be either provider services or
consumer services with `EventDirection: SubscriberFires` — the backend resolves the
`(owner, slug)` tuple against both containers uniformly.

```json
{
  "default_service_owner": "platform-team-org",
  "services": [
    {
      "step_id": "create-sub",
      "service_slug": "new-azure-subscription",
      "requested_by": "dev-team-a",
      "input": {
        "billing_account": "ba-123"
      }
    },
    {
      "step_id": "create-rg",
      "service_slug": "new-azure-resource-group",
      "requested_by": "dev-team-a",
      "depends_on": ["create-sub"],
      "input": {
        "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}"
      }
    },
    {
      "step_id": "create-kv",
      "service_slug": "new-azure-keyvault",
      "requested_by": "dev-team-a",
      "depends_on": ["create-rg"],
      "input": {
        "resource_group": "${{ steps.create-rg.outputs.resource_group_name }}"
      }
    }
  ]
}
```

**Required fields per step:**
- `step_id` — unique string within the request, alphanumeric + `_-`, max 64 chars.
  Used in `depends_on` and in `${{ steps.STEP_ID.outputs.X }}` template expressions.
- `service_slug` — the target service's slug. Regex: `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
  (lowercase kebab-case, 2–64 chars).
- `input` — any JSON object (may contain `${{ steps.STEP_ID.outputs.FIELD }}` strings).

**Optional fields per step:**
- `service_owner_name` — GitHub org name of the service owner. Required at either the
  step level OR via the request-root `default_service_owner`. Step-level value wins when
  both are set.
- `requested_by` — informational team name, max 256 chars. Never used for routing or auth.
- `depends_on` — array of `step_id` strings; omit for sequential linear chains.

**Top-level optional:**
- `default_service_owner` — GitHub org name inherited by any step that omits its own
  `service_owner_name`. Simplifies the common case where a whole chain targets one org.
- `execution_mode` — if present in the payload, it takes precedence over the
  `execution_mode` input; otherwise the input value is used. Accepted value: `"sequential"`.

**Validation the action must perform client-side (before API call):**
1. `services` array is present and has 1–20 items
2. All `step_id` values are unique within the request
3. Every step has `service_slug` and it matches the format regex
4. Every step has an owner resolvable to it (step-level `service_owner_name` OR
   request-root `default_service_owner`)
5. All `depends_on` references point to a `step_id` that exists in the request
6. `input` is a valid JSON object on every step
7. Parse error on the `payload` input → fail immediately with a human-readable message

### 5.2 What the action POSTs to the backend

The action wraps the consumer's payload into the `SubmitOrchestrationRequest` body,
forwarding all top-level fields (`default_service_owner`, `execution_mode` if set inside
the payload) verbatim:

```bash
REQUEST_BODY=$(jq -n \
  --argjson payload "$INPUT_PAYLOAD" \
  --arg run_id "$GITHUB_RUN_ID" \
  --arg mode "$INPUT_EXECUTION_MODE" \
  '{
    workflow_run_id: ($run_id | tonumber),
    execution_mode: ($payload.execution_mode // $mode),
    default_service_owner: $payload.default_service_owner,
    services: $payload.services
  } | with_entries(select(.value != null))')

RESPONSE=$(curl -sf -X POST "$ZEKT_API_BASE/api/orchestration/submit" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Repository: $GITHUB_REPOSITORY" \
  -d "$REQUEST_BODY")

EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.execution_id')
echo "execution_id=$EXECUTION_ID" >> "$GITHUB_OUTPUT"
```

### 5.3 Optional wait / poll loop (when `wait: true`)

```bash
if [ "$INPUT_WAIT" = "true" ]; then
  echo "Polling orchestration status for $EXECUTION_ID ..."
  while true; do
    STATUS_RESPONSE=$(curl -sf "$ZEKT_API_BASE/api/orchestration/$EXECUTION_ID/status" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "X-GitHub-Repository: $GITHUB_REPOSITORY")

    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')

    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "timed_out" ]; then
      echo "execution_status=$STATUS" >> "$GITHUB_OUTPUT"

      # Write each step's outputs as: step_{step_id}_outputs_{field}=value
      echo "$STATUS_RESPONSE" | jq -r '
        .steps[] |
        . as $step |
        (.outputs // {}) | to_entries[] |
        "step_\($step.step_id)_outputs_\(.key)=\(.value)"
      ' >> "$GITHUB_OUTPUT"

      if [ "$STATUS" != "completed" ]; then
        echo "::error::Orchestration $EXECUTION_ID ended with status: $STATUS"
        exit 1
      fi
      break
    fi

    echo "Status: $STATUS — waiting 30s ..."
    sleep 30
  done
fi
```

---

## 6. Consumer-Facing Usage Examples

### 6.1 Fire-and-forget (no wait)

```yaml
- name: Submit orchestration
  id: orchestrate
  uses: zekt-dev-org/zekt-action@v3
  with:
    orchestrate: true
    payload: |
      {
        "default_service_owner": "platform-team-org",
        "services": [
          {
            "step_id": "create-sub",
            "service_slug": "new-azure-subscription",
            "input": { "billing_account": "ba-123" }
          },
          {
            "step_id": "create-rg",
            "service_slug": "new-azure-resource-group",
            "depends_on": ["create-sub"],
            "input": { "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}" }
          }
        ]
      }

- name: Log execution ID
  run: echo "Execution: ${{ steps.orchestrate.outputs.execution_id }}"
```

### 6.2 Wait for completion

```yaml
- name: Submit and wait
  id: orchestrate
  uses: zekt-dev-org/zekt-action@v3
  with:
    orchestrate: true
    wait: true
    payload: |
      {
        "default_service_owner": "platform-team-org",
        "services": [...]
      }

- name: Use outputs
  run: |
    echo "Status: ${{ steps.orchestrate.outputs.execution_status }}"
    echo "Sub ID: ${{ steps.orchestrate.outputs.step_create-sub_outputs_subscription_id }}"
```

> Step outputs are written to `$GITHUB_OUTPUT` as `step_{step_id}_outputs_{field}` — the
> `step_id` is the caller-defined identifier from the payload, not the service slug.

### 6.3 Standard non-orchestrated call — unchanged

```yaml
- uses: zekt-dev-org/zekt-action@v3
  with:
    event-type: 'deployment'
    payload: '{"result": "success", "version": "1.2.3"}'
```

---

## 7. Provider Workflow: Receiving an Orchestration Dispatch

This section documents what an **orchestration-compatible provider service workflow** looks
like on the **receive side** — i.e., what the provider workflow must do when Zekt calls it
as part of an orchestration chain.

### 7.1 When this applies

This section is relevant ONLY when a provider workflow is the target of an orchestration
step (`orchestrate: true` was used by the consumer). Standard non-orchestrated Zekt flows
(provider → subscriber dispatch) are completely unaffected — their `client_payload`
structure does not change.

### 7.2 What Zekt sends to the provider repo

When Zekt dispatches an orchestration step to a provider repo, it sends a `repository_dispatch`
event with this `client_payload` structure:

```json
{
  "input": {
    "billing_account": "ba-123"
  },
  "_zekt": {
    "orchestration": {
      "executionId": "exec-abc123",
      "stepId": "create-sub",
      "requestorRepository": "dev-team-org/dev-repo"
    }
  }
}
```

The `input` object contains the fully-resolved step input (template expressions like
`${{ steps.N.outputs.X }}` are substituted by the Zekt backend before dispatch). The
`_zekt` object is read automatically by `zekt-action` — the provider workflow does not
need to touch it.

### 7.3 How to read input parameters

The provider workflow reads its parameters from `github.event.client_payload.input`:

```yaml
on:
  repository_dispatch:
    types: [new-azure-subscription-request]   # the event type registered in Zekt Registry

jobs:
  create-subscription:
    runs-on: ubuntu-latest
    steps:
      - name: Extract input
        id: input
        run: |
          echo "billing_account=${{ github.event.client_payload.input.billing_account }}" \
            >> "$GITHUB_OUTPUT"

      - name: Do the work
        id: work
        run: |
          # Create subscription using ${{ steps.input.outputs.billing_account }}
          SUBSCRIPTION_ID="sub-$(date +%s)"
          echo "subscription_id=$SUBSCRIPTION_ID" >> "$GITHUB_OUTPUT"

      - name: Report outputs back to Zekt
        uses: zekt-dev-org/zekt-action@v3
        with:
          # No orchestrate: true here — this is the provider reporting its output.
          # zekt-action auto-detects the _zekt orchestration context from the event file.
          payload: |
            {
              "subscription_id": "${{ steps.work.outputs.subscription_id }}"
            }
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 7.4 Handling both orchestrated and direct dispatches (optional)

If a provider workflow needs to support being called **both** via Zekt orchestration
and via a direct `repository_dispatch` (e.g., from a human or another system), it can
branch on the presence of `_zekt`:

```yaml
      - name: Extract input (conditional path)
        id: input
        run: |
          if [ '${{ toJson(github.event.client_payload._zekt) }}' != 'null' ]; then
            # Called via Zekt orchestration — input is under client_payload.input
            echo "billing_account=${{ github.event.client_payload.input.billing_account }}" \
              >> "$GITHUB_OUTPUT"
          else
            # Called directly — input may be at the root of client_payload
            echo "billing_account=${{ github.event.client_payload.billing_account }}" \
              >> "$GITHUB_OUTPUT"
          fi
```

### 7.5 What "zero changes required" actually means

| Aspect | Zero changes? | Notes |
|---|---|---|
| `zekt-action` output call | ✅ Yes | Auto-detects `_zekt` context from `$GITHUB_EVENT_PATH` |
| Input parameter reading | ⚠️ Conditional | Must read from `client_payload.input` when called via orchestration |
| Workflow trigger (`on:`) | ✅ Yes | Uses the same event type already registered in Zekt Registry |
| Secrets / tokens | ✅ Yes | `GITHUB_TOKEN` works the same way |

The `supportsOrchestration` flag (Phase 2 of spec 113) will allow providers to explicitly
advertise orchestration compatibility in the Zekt Registry.

---

## 8. Implementation Steps

Work through these in order. Each step can be committed independently.

**Step 1 — `action.yml` inputs and outputs**  
Add the three new inputs (`orchestrate`, `execution_mode`, `wait`) and two new outputs
(`execution_id`, `execution_status`). All new inputs have defaults so they are fully
optional. Existing inputs and outputs are untouched.

**Step 2 — Provider-side auto-detection (non-orchestrated path)**  
In the existing `entrypoint.sh` register-run call, add the `GITHUB_EVENT_PATH` read and
`orchestration_step_ref` construction described in Section 4.1–4.3. **Critical:** unwrap
`_zekt.orchestration` and remap `executionId → execution_id`, `stepId → step_id`. Do NOT
send the raw `_zekt` object verbatim.

**Acceptance tests for Step 2:**

1. **Standard `workflow_dispatch` call** — no event context: request body must NOT contain
   `orchestration_step_ref` (or it may be `null`), and existing v2 behavior is preserved.
2. **`repository_dispatch` without `_zekt`** — e.g., a manual `gh api ... /dispatches`
   call: request body must NOT contain `orchestration_step_ref`.
3. **`repository_dispatch` with valid `_zekt.orchestration`** — request body MUST contain
   `orchestration_step_ref: { "execution_id": "exec-...", "step_id": "..." }` with exact
   snake_case keys. Verify by mocking the Zekt API and asserting the received JSON.
4. **`repository_dispatch` with partial `_zekt.orchestration`** (only `executionId`, no
   `stepId`, or vice versa): request body must NOT contain `orchestration_step_ref` and a
   `::warning::` line must be emitted.

**Step 3 — Client-side payload validation (orchestration path)**  
Before making any API call when `orchestrate: true`, validate that `payload` parses as
valid JSON and contains a `services` array with 1–20 items. Check `step_id` uniqueness
and `depends_on` references. Emit `::error::` lines and `exit 1` on any failure.

**Step 4 — Submit orchestration call**  
Implement the `POST /api/orchestration/submit` call (Section 5.2). Write `execution_id`
to `$GITHUB_OUTPUT`. Log the execution ID to the step summary.

**Step 5 — Wait / poll loop**  
Implement the optional poll loop (Section 5.3). Write `execution_status` and all
`step_{id}_outputs_{field}` values to `$GITHUB_OUTPUT`. Exit with code 1 when status is
not `completed`.

**Step 6 — README updates**  
Add an "Orchestration" section to the action README with the examples from Section 6.
Clearly document the `orchestrate: true` requirement and the payload schema.

**Step 7 — Version bump to v3**  
Update `action.yml` version references, tag, and the `v3` major version alias.

---

## 9. Concerns and Edge Cases

### 8.1 `payload` is a multiline YAML string

Consumers will likely write `payload` as a multiline YAML block scalar (`payload: |`).
The action receives this as a single string. Ensure the JSON parse step handles leading/
trailing whitespace and newlines correctly. Prefer `jq empty <<< "$INPUT_PAYLOAD"` for
validation rather than shell string manipulation.

### 8.2 Poll loop and job timeout

When `wait: true`, the action will block for as long as the orchestration runs (up to 24
hours by the Zekt backend limit). The consumer's GitHub Actions job must have a `timeout-minutes`
set at the job or step level if they want a hard cap. Document this prominently in the README.
Do not add an internal timeout to the poll loop — that is the consumer's responsibility.

### 8.3 `execution_mode` conflict resolution

`execution_mode` can be specified as an action input AND as a key inside the `payload`
object. The rule: if `payload.execution_mode` exists, it wins. If not, fall back to the
`execution_mode` action input. If neither is present, default to `"sequential"`.

### 8.4 `${{ steps.N.outputs.FIELD }}` expressions in `input`

These template expressions in the consumer's payload are **not** resolved by the action.
They are passed verbatim to the Zekt backend, which resolves them at dispatch time (after
each dependent step completes). The action must not attempt to expand them client-side.

### 8.5 Error response handling

When the backend returns a non-2xx status, the action must:
- Print the HTTP status code and response body using `::error::` syntax
- Exit with code 1
- Never expose any internal backend detail beyond what the response body contains

Use `curl -f` (fail on non-2xx) and capture stderr separately. Do not swallow errors.

**Uniform `403` for auth/resolution:** The backend returns `403` with the message
`"Service '{owner}/{slug}' not found or you are not authorized to use it."` for BOTH
"unknown slug" and "known slug but no approved subscription". This is intentional
(prevents enumeration). The action should surface this message verbatim — do not
attempt to interpret it or split the two cases.

### 8.6 Backwards compatibility guarantee

The backend tolerates `orchestration_step_ref` being either **absent** or explicitly
`null` — both are treated identically as "non-orchestrated call". The reference
implementation in Section 4.2 **omits** the field entirely when there is no orchestration
context, which keeps request bodies minimal and matches the exact wire format the pre-v3
`register-run` clients used.

**Field mapping cheat sheet** (source → destination):

| From `client_payload._zekt.orchestration` | → | `orchestration_step_ref` field |
|---|---|---|
| `executionId` (camelCase, string) | → | `execution_id` (snake_case, string) |
| `stepId` (camelCase, string) | → | `step_id` (snake_case, string) |
| `requestorRepository` | → | **not forwarded** — backend-only field |

### 8.7 GitHub token scope

The same `GITHUB_TOKEN` used for existing `register-run` calls is used for orchestration
submit and status poll. No additional token configuration is required from the consumer.
The Zekt backend validates the token against the `X-GitHub-Repository` header.

---

## 9. Key Files to Modify

| File | Change |
|---|---|
| `action.yml` | Add 3 inputs, 2 outputs |
| `entrypoint.sh` (or equivalent) | Branch on `INPUT_ORCHESTRATE`; add auto-detection for provider path |
| `README.md` | New "Orchestration" section |

If the action uses a compiled language or bundled JS instead of shell, apply the same
logic structure — the branching on `orchestrate`, the two API endpoints, and the poll loop
are language-agnostic.

---

## 10. Reference: API Endpoints

| Method | Path | Used when |
|---|---|---|
| `POST` | `/api/zekt/register-run` | `orchestrate: false` (existing) |
| `POST` | `/api/orchestration/submit` | `orchestrate: true` |
| `GET` | `/api/orchestration/{execution_id}/status` | `orchestrate: true` + `wait: true` |

All requests:
- `Authorization: Bearer $GITHUB_TOKEN`
- `Content-Type: application/json`
- `X-GitHub-Repository: $GITHUB_REPOSITORY`

---

## 11. Reference: JSON Schemas

The full JSON schemas for the request/response bodies are in the Zekt main repo at:

```
specs/113-true-github-workflow-orchestration/schemas/
  submit-orchestration-request.schema.json       ← what this action POSTs (orchestrate: true)
  provider-dispatch-client-payload.schema.json   ← what the backend sends to provider repos
  register-run-extension.schema.json             ← extension to the existing register-run body
  orchestration-callback-payload.schema.json     ← the zekt-orchestration-result callback shape
```

The most relevant for this implementation is `submit-orchestration-request.schema.json`
(the shape of the `payload` input when `orchestrate: true`) and
`register-run-extension.schema.json` (the `orchestration_step_ref` field added to the
existing register-run call).
