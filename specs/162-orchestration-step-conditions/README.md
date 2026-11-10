# Spec 162 — Orchestration step conditions (pointer)

**This is a pointer, not a copy.** The agreed brief for this repository is section **3.7 zekt-action brief** of the
common spec, which is the single source of truth:

```
C:\Develop\zektMainWeb\specs\162-orchestration-step-conditions\plan.md    § 3.7
```

Context for § 3.7: § 1a (c), § 2 (decisions D1–D16), § 3.2–3.4. Core and this repository agree on that section in
place — answers and changes are amended there, not duplicated here.

## What landed here

| # | Item | Where |
|---|---|---|
| ZA1 | `condition`, `condition_description`, and the previously undeclared `timeout_minutes` / `input_schema_version` on `OrchestrationStep`; status fields; `excluded_steps`; submit `status` | `src/types.ts` |
| ZA2 | No client-side decision — the plan is cast, not rebuilt, and is sent whole | `src/orchestrate.ts` (unchanged behaviour) |
| ZA3 | D9/D10 validation stays with Core | — (deliberately no code) |
| ZA4 | Empty-render hint on a `JSON.parse` failure | `src/orchestrate.ts` |
| ZA5 | `step_{id}_status` + `excluded_steps` outputs, info line per excluded step, all-excluded fire-and-forget line | `src/orchestrate.ts`, `action.yml` |
| ZA6 | `condition` + `status` summary columns, HTML escaping, summary on failure (F2) | `src/orchestrate.ts` |
| ZA7 | Ignored-condition warning for a backend that predates conditions | `src/orchestrate.ts` |
| ZA8 | Quoted-condition hint on Core's invalid-condition 400 | `src/orchestrate.ts` |
| ZA9 | Docs, tests, 3.3.0, CHANGELOG, `dist/` | `README.md`, `__tests__/orchestration-conditions.test.ts` |

## The two findings this repository contributed

- **F1 (ZA1, ZA5)** — `exclusion_reason` is typed `string`, not a union of the two known values, and an unknown
  reason is still logged (`step '<id>' excluded (<reason>)`). A reason Core adds later must not become a compile
  error here, and must not fall silently through the logging branch.
- **F2 (ZA6)** — `pollUntilTerminal` returns the terminal status response and the job summary is written *before* the
  run is failed. Before this change a failed or timed-out orchestration produced no job summary at all, which is
  exactly the case someone opens the summary to understand.

## The rule behind ZA3

The action validates on the client only what the backend cannot report back: a **silent coercion** (a value the
backend would act on in a way the caller cannot see) or a **silent ignore** (an older backend dropping the field).
Anything the backend refuses with a step-named 400 stays with the backend.

That is why `strict_output_schema_resolution` is checked here and `condition` is not, and it is the rule to apply to
the next field rather than re-deciding case by case.

## Release constraint

Do **not** merge to `main` or move the `v3` tag until Core's Phase 1 is on production: three example repositories pin
`zekt-action@main`, so a merge reaches them immediately, and a README documenting conditions against a backend that
ignores them describes a feature that silently does nothing. ZA7 is the safety net for that window, not the plan.
Moving the tag is the owner's call.
