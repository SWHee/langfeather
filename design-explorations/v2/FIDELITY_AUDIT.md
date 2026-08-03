# V2 Fidelity Audit

**Audit date:** 2026-08-02  
**Result:** **NOT ACCEPTED — P0: 0, P1: 4, P2: 0**

The six `*-light.html` files are the sole visual authority for this audit. The
current React UI was evaluated as a derived implementation, not as a baseline;
therefore a materially different but functional implementation is still a
fidelity failure.

## Scope and method

- Read every V2 reference and `IMPLEMENTATION_CHECKLIST.md` before inspecting
  React implementation code.
- Served the references at `http://127.0.0.1:4321` and the live React app at
  `http://127.0.0.1:5174` on separate local ports. The live app used a
  disposable local API fixture with non-empty trace, queue, score, dataset,
  experiment, and settings states.
- Captured each reference and its corresponding implementation at a desktop
  1280 CSS-pixel viewport and at a native iPhone 12 viewport (390 x 844 CSS
  pixels). Desktop comparisons used a temporary local two-frame harness only
  to place the separately served pages side by side; mobile captures were
  direct pages.
- Exercised the primary non-destructive interactions with keyboard input,
  dialogs/drawers, Escape, table/detail flows, graph selection, chart controls,
  and destructive-confirmation cancellation. No product data was mutated.

## Reference integrity and implementation-boundary checks

| Check | Result | Evidence |
| --- | --- | --- |
| V2 reference files unchanged during audit | Pass | SHA-256 values were identical before and after the audit for all six files. The files are untracked in this worktree, so this is a session-integrity check rather than a committed-Git-baseline comparison. |
| Legacy presentation reused | No P0 found | The current source tree contains the new V2 surface modules (`traces`, `scores`, `settings`, `evaluation`, `QueuesView`, `RuntimeGraphView`); the deleted legacy presentation modules have no remaining references in `web/src`. This is source/diff evidence, not a claim that the prior UI is a valid visual baseline. |
| Product code and V2 originals changed by this audit | No | This audit wrote only this report. |

Reference SHA-256 values:

```text
4e95af98b44c3c37b90b79201e06472148d5de1d712b7fb73d4904cb2402008d  claude-annotation-queues-light.html
0ce2ab086ea25f89d1aed7529a7d6854e3879fc80ffd82fc838b95b8d5740717  claude-evaluation-light.html
de59a9e7fb2016f5fede119f68f29b32f33878f8fa5a4271211d1f942c5528a8  claude-modular-observatory-light.html
0ab5b6b64b4baa6b248a8057a411fe593b9face3bdb32ae05cbe35c54c5410c0  claude-scores-light.html
22b658eca7f58782e0ab5ea784a41e325bfd5bb8376925a6bb978e5672ac4c4d  claude-settings-light.html
2bd06bb6114ada42bb3f4c2494229aa2c848399b94ddddde80baf9650f55c881  claude-traces-workspace-light.html
```

## Screenshot and route evidence

The following screenshot request IDs are retained in the Orca embedded-browser
run. In each mobile cell, the first ID is the reference and the second is the
direct React page.

| Checklist surface | Reference route | React route | Desktop side-by-side capture | Native 390 px capture |
| --- | --- | --- | --- | --- |
| Overview | `/claude-modular-observatory-light.html` | `/?view=overview` | `bbea8653-e1e1-4fed-ac9b-66436fd7259c` | `5fc4cef8-16fc-42cd-af92-f73fcf199209`; `5ab6503b-975f-4c69-8233-3eef8a5ee2f1` |
| Traces | `/claude-traces-workspace-light.html` | `/?view=traces` | `8cbae189-eb0c-4f0d-a931-65ed99cf9122` | `11f555b9-ff00-4cda-830a-ba0a70ac5d7d`; `f2a6aed3-6352-430e-ad3b-63423c315db6` |
| Annotation queues | `/claude-annotation-queues-light.html` | `/?view=queues` | `89e44e23-2e83-440e-a423-e7d92fd39696` | `7a3e3cf0-0162-4576-baf0-cdc7f184ba74`; `97e6b7dc-b556-415d-a2c7-621bd78e0280` |
| Scores | `/claude-scores-light.html` | `/?view=scores` | `2ac313a3-c01a-426e-8ceb-dfa0f8f559aa` | `2cab72a7-086a-4a2b-94bc-02196f0cabfa`; `50a956ca-c530-41cf-9cd9-158eedb960f7` |
| Evaluation | `/claude-evaluation-light.html` | `/?view=datasets` | `83ad3079-9b35-47b4-8396-618b1020c004` | `66ce9bda-ed27-45a0-ab1f-cfbc95840b9e`; `646a0081-aec2-4bdd-b935-8e0d6ac90228` |
| Setting | `/claude-settings-light.html` | `/?view=data` | `f6bcdebf-169d-438a-af35-1c7da67670a7` | `48a8ffb0-1bf2-4796-bfcd-f088257d9514`; `6b0bda61-dc7b-4837-a0f6-d192a876f4ed` |

## Automated and runtime evidence

| Check | Result |
| --- | --- |
| `git diff --check` | Pass (exit 0) |
| `npm run lint --prefix web` | Pass (exit 0) |
| `npm run typecheck --prefix web` | Pass (exit 0) |
| `npm test --prefix web -- --run` | Pass (7 files / 32 tests) |
| `npm run build --prefix web` | Pass (Vite build, exit 0) |
| UI-pattern detector against the V2 implementation files | Pass (`[]`) |
| Embedded-browser console errors/warnings | None after live fixture setup |
| Embedded-browser HTTP requests with status >= 400 | None after live fixture setup |

`orca set media --reduced-motion reduce` acknowledged the setting, but the
embedded browser still reported `matchMedia('(prefers-reduced-motion: reduce)')
.matches === false` after reload. Runtime media emulation is therefore not
claimed as verified. The source-level reduced-motion rule exists globally, but
P1-01 independently identifies an Overview interaction that hard-codes smooth
scrolling and fails to respect that rule.

## Findings

### P0 — none found

No V2 surface was missing, no section was replaced with a different primary
screen, and source/diff inspection found no evidence that the deleted legacy
presentation was re-imported as the implementation baseline.

### P1-01 — Overview chart navigator does not preserve V2 active state, announcement, or reduced-motion behavior

**Checklist impact:** Global interaction/reduced motion; Overview chart
navigator and chart interaction requirements.

**Expected from the reference:** The chart navigator owns a visible selected
state through `aria-current="true"`, updates that state when a chart is chosen,
announces the destination, applies the reference highlight behavior, and uses
`auto` rather than smooth scrolling when reduced motion is preferred.

**Actual React behavior:** Every navigator button remains without
`aria-current`; there is no selected affordance, no reference-style highlight,
and no announcement. Its click handler calls `scrollIntoView({ behavior:
"smooth" })` unconditionally.

**Reproduction/evidence:** On the native 390 px React Overview page, focus
`Trace Count` and press Enter. The inspected navigator state was:

```text
Trace Count ariaCurrent=null
Latency     ariaCurrent=null
Error Rate  ariaCurrent=null
LLM Calls   ariaCurrent=null
Tool Calls  ariaCurrent=null
```

The reference uses `aria-current` and changes it in `jumpToChart`; React
`OverviewView.tsx` only scrolls to the target. This is material chart
interaction semantics and a reduced-motion mismatch, not cosmetic proximity.

### P1-02 — Traces filter composition and mobile density differ from the actual V2 reference

**Checklist impact:** Traces toolbar/filter/table structure, responsive density,
and source-authority requirement.

**Expected from the reference:** The V2 Traces toolbar has four fields: search,
status, a relative period selector, and tag. At mobile width it remains that
source-defined control set and its associated compact geometry.

**Actual React behavior:** The implementation renders six fields: search,
status, start datetime, end datetime, tag, and Session ID, followed by
actions. It removes the source relative-period selector and materially
increases the toolbar height at 390 px.

**Reproduction/evidence:** Compare the native captures
`11f555b9-ff00-4cda-830a-ba0a70ac5d7d` (reference) and
`f2a6aed3-6352-430e-ad3b-63423c315db6` (React). The live React accessibility
snapshot exposes all six fields. The implementation may support useful extra
filters, but the actual V2 HTML is authoritative over the checklist's
descriptive wording; this is a material structure/density and interaction
difference.

### P1-03 — Shared management mobile shell hides the LangFeather wordmark where the V2 management references retain it

**Checklist impact:** Global navigation and responsive behavior; Annotation
Queues, Scores, Evaluation, and Setting mobile shells.

**Expected from the references:** At approximately 390 px, the management-page
references retain the `LangFeather` wordmark in the top bar. (This finding does
not apply to the distinct Overview/Traces references, which intentionally hide
their wordmark at the corresponding breakpoint.)

**Actual React behavior:** The shared `@media (max-width: 520px)` rule assigns
`.lf-wordmark { font-size: 0; }`, removing the wordmark from all management
surfaces.

**Reproduction/evidence:** Direct native captures show `LangFeather` in the
reference but only the mark in React for Queues (`7a3e3cf0-0162-4576-baf0-
cdc7f184ba74` vs `97e6b7dc-b556-415d-a2c7-621bd78e0280`), Scores
(`2cab72a7-086a-4a2b-94bc-02196f0cabfa` vs `50a956ca-c530-41cf-9cd9-
158eedb960f7`), and Setting (`48a8ffb0-1bf2-4796-bfcd-f088257d9514` vs
`6b0bda61-dc7b-4837-a0f6-d192a876f4ed`). This is a shared responsive global
navigation discrepancy across multiple required pages.

### P1-04 — Traces Add-to-queue Escape priority retains hidden action-menu state and requires a third Escape

**Checklist impact:** Traces primary actions, drawer/dialog focus/Escape
behavior, and interaction-state fidelity.

**Expected from the reference:** From an open trace drawer with `Trace 작업`
menu and `Add to queue` picker open, the first Escape closes the visible picker
and its actions layer together. The next Escape closes the trace drawer and
returns focus to its trigger. Each press dismisses one visible interaction
layer; no hidden menu state remains between the picker and drawer.

**Actual React behavior:** The first Escape correctly closes the visible
Add-to-queue picker. A second Escape does **not** close the drawer because it
only clears a still-set, now invisible `action === "menu"` state. A third Escape
is required to close the drawer.

**Exact reproduction:**

1. On the native 390 px React Traces page, focus a trace row and press Enter to
   open the detail drawer.
2. Focus `Trace 작업`, press Enter, then focus `Add to queue` and press Enter to
   open the queue picker.
3. Press Escape once: the picker closes. Press Escape a second time: inspected
   drawer state remains `.trace-drawer.is-open === true`.
4. Press Escape a third time: inspected drawer state becomes
   `.trace-drawer.is-open === false`.

The second-Escape evidence was captured as `09a9dcc1-4c1c-4c1c-9bc2-2d565774f8c9`
with the drawer still open; the subsequent third-Escape close was captured as
`e1606398-5ca4-4553-a416-5b1d9c336537`. The React Escape handler prioritizes
`setAction(null)` after the picker is already closed, while the reference
`closeTraceActions()` clears picker/menu state together. This is a reproducible
keyboard and focus-layer P1, not a timing issue.

### P2 — none isolated

No small, independent P2 issue is recorded. The audit does not downgrade any
of the material structural, responsive, chart-interaction, or Escape failures
above into "close enough" spacing differences.

## Checklist disposition

| Checklist section | Disposition | Evidence / finding IDs |
| --- | --- | --- |
| Visual authority, rebuild boundary, no old presentation reuse | Pass with untracked-reference caveat | Session SHA-256 match; source/diff boundary check; no P0 |
| Global shell, palette, navigation, table/dialog foundations | Blocked | Navigation exists and six routes render; management mobile wordmark is P1-03; reduced-motion interaction is also implicated by P1-01 |
| Overview | Blocked | Five charts, keyboard chart focus, layout editing, and responsive layout were exercised; navigator selected state/announcement/reduced-motion behavior fails in P1-01 |
| Traces | Blocked | Real table, trace drawer, evidence graph, node I/O, and action picker were exercised; filter composition fails in P1-02 and picker/Escape priority fails in P1-04 |
| Annotation queues | Blocked by global responsive defect | Queue detail, graph/I-O, annotation controls, and Escape close were exercised; its mobile shell is affected by P1-03 |
| Scores | Blocked by global responsive defect | Dense score table and New Score dialog/Escape cancellation were exercised; its mobile shell is affected by P1-03 |
| Evaluation | Blocked by global responsive defect | Dataset page, tabs, same-revision selection, and comparison visualization were exercised; its mobile shell is affected by P1-03 |
| Setting | Blocked by global responsive defect | RESET confirmation and Escape cancellation were exercised without deletion; its mobile shell is affected by P1-03 |
| Required automated evidence | Pass | Diff check, lint, typecheck, tests, build, detector, console, and failed-network checks listed above |
| Browser reduced-motion runtime proof | Inconclusive | Embedded-browser media override did not make `matchMedia` true; do not count runtime reduced-motion as verified |

## Primary interaction evidence that did pass

- Overview: chart point keyboard focus exposed the timestamp/status tooltip;
  layout-edit mode exposed width controls and changed a chart span.
- Traces: row keyboard open, evidence-graph node selection, and I/O payload
  inspection worked with real fixture data.
- Annotation queues: queue row opened a review detail surface with evidence
  graph, input/output and boolean/number/categorical annotation controls;
  Escape closed the drawer.
- Scores: `New Score` opened the expected modal and Escape cancelled it without
  submission.
- Evaluation: the dataset page switched examples/experiments and produced a
  comparison visualization after selecting same-revision experiments.
- Setting: entering `RESET` opened the confirmation dialog and Escape cancelled
  it without clearing data.

## Acceptance decision and remaining blockers

Acceptance requires zero P0 and zero P1 findings. This audit has zero P0 but
four P1 findings, so the V2 implementation is **not ready for acceptance**.

Remaining blockers are:

1. Implement the V2 Overview chart navigator's selected state, destination
   announcement/highlight behavior, and reduced-motion-aware scrolling.
2. Restore the actual V2 Traces filter structure and its responsive geometry;
   do not substitute additional filters for the source period control.
3. Scope the mobile wordmark hiding rule so the management references retain
   their wordmark at the source breakpoint.
4. Clear the Traces action-menu state when the Add-to-queue picker closes so
   Escape dismisses visible layers in the reference priority order.
5. Re-run the reduced-motion browser check in an environment that demonstrably
   applies `prefers-reduced-motion: reduce`, after P1-01 is corrected.
