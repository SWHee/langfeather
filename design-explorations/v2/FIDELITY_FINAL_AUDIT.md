# V2 Fidelity Final Acceptance Audit

**Audit date:** 2026-08-02
**Auditor:** independent reviewer (Claude Opus 5), terminal `term_4de3b521-dd01-4c99-997a-af7d16ac7b7a`
**Scope:** final acceptance audit of the V2 React implementation after the
`P1-R01` fix
**Result:** **ACCEPTED — P0: 0, P1: 0 open, P2: 1 documented**

The six `design-explorations/v2/*-light.html` files remain the sole visual
authority. `P1-R01`, the single blocker recorded in `FIDELITY_REAUDIT.md`, is
independently confirmed resolved by source reading, focused tests, and live
rendering against the real zero-tool server response at both viewports. The four
original P1 findings and the Overview Recent Traces requirement are confirmed
still resolved by a narrow regression pass. Acceptance is granted.

---

## 1. Acceptance summary

| Severity | Count | Status |
| --- | --- | --- |
| **P0** | **0** | none found |
| **P1** | **0 open** | `P1-R01` resolved; `P1-01`, `P1-02`, `P1-03`, `P1-04` remain resolved |
| **P2** | **1** | `P2-R01` documented, non-blocking, unchanged |

Acceptance requires zero open P0 and zero open P1. Both conditions are met.

### 1.1 Finding table

| ID | Severity | Status | Surface | Evidence |
| --- | --- | --- | --- | --- |
| — | P0 | none found | — | five source charts present, six routes in source order, no replaced IA, no legacy presentation reused |
| **P1-R01** | P1 | **RESOLVED** | Overview | §3 — source, 4 focused tests, live desktop + 390px against the real `__others__: 0` response |
| P1-01 | P1 | RESOLVED (no regression) | Overview | §5.1 |
| P1-02 | P1 | RESOLVED (no regression) | Traces | §5.2 |
| P1-03 | P1 | RESOLVED (no regression) | Global shell | §5.3 |
| P1-04 | P1 | RESOLVED (no regression) | Traces | §5.4 |
| — | — | PASS (no regression) | Overview | §5.5 Recent Traces click / Enter / Space / URL / graph / I-O / Escape focus |
| **P2-R01** | P2 | OPEN, documented | Traces / Scores / Queues | §6 — unchanged from `FIDELITY_REAUDIT.md`; P2 may remain per the acceptance rule |

---

## 2. Reference integrity and audit boundary

| Check | Result | Evidence |
| --- | --- | --- |
| V2 reference SHA-256 at audit start | recorded | block below |
| V2 reference SHA-256 at audit end | **identical** | block below |
| Product code modified by this audit | **No** | only `design-explorations/` is untracked-new; `git status --short design-explorations/` shows `?? design-explorations/` and nothing else |
| V2 `*-light.html` modified by this audit | **No** | checksums identical; this audit wrote only `FIDELITY_FINAL_AUDIT.md` |
| `git diff --check` | **Pass** (exit 0) | §4 |
| Build artifacts dirtying the tree | No | `web/dist/` is gitignored (`.gitignore:20`) |

Checksums, identical at start and end of this audit and identical to the values
recorded in `FIDELITY_AUDIT.md`, `FIDELITY_REAUDIT.md`, and the remediation report:

```text
4e95af98b44c3c37b90b79201e06472148d5de1d712b7fb73d4904cb2402008d  claude-annotation-queues-light.html
0ce2ab086ea25f89d1aed7529a7d6854e3879fc80ffd82fc838b95b8d5740717  claude-evaluation-light.html
de59a9e7fb2016f5fede119f68f29b32f33878f8fa5a4271211d1f942c5528a8  claude-modular-observatory-light.html
0ab5b6b64b4baa6b248a8057a411fe593b9face3bdb32ae05cbe35c54c5410c0  claude-scores-light.html
22b658eca7f58782e0ab5ea784a41e325bfd5bb8376925a6bb978e5672ac4c4d  claude-settings-light.html
2bd06bb6114ada42bb3f4c2494229aa2c848399b94ddddde80baf9650f55c881  claude-traces-workspace-light.html
```

The references are untracked in this worktree, so this remains a session-integrity
check rather than a committed-Git-baseline comparison — the same caveat carried by
the two prior reports.

---

## 3. P1-R01 — RESOLVED

**Original finding** (`FIDELITY_REAUDIT.md` §3.2): the Overview Tool Calls chart
rendered the server's internal `__others__` aggregation key as a user-facing
zero-value legend series in `#163b70` with a flat baseline and no empty state,
violating `specs/web-functional.md:60` by name and Authority item 4 of
`IMPLEMENTATION_CHECKLIST.md`.

### 3.1 The blocking condition still exists on the server side

The fix is a client-side one; the server contract is unchanged, so the exact
condition that produced the finding is still reproducible from the live API:

```console
$ curl -s "http://127.0.0.1:8000/api/v1/dashboard?from=2026-07-26T00:00:00Z&to=2026-08-02T23:59:59Z&timezone=UTC"
totals.tool_calls       = 0
available_tools         = []
bucket tool_calls keys  = ['__others__']
first bucket tool_calls = {'__others__': 0}
```

This is the same response shape that reproduced the defect. Any pass below is
therefore a genuine fix, not a changed input.

### 3.2 Source verification

`web/src/overview/OverviewView.tsx`:

| Line(s) | Behaviour |
| --- | --- |
| `59` | `const OTHERS_TOOL_KEY = "__others__";` with an explanatory comment: *"Server-internal aggregation key. It is never a tool the user invoked, so it must not reach the Tool Calls legend or line."* |
| `90-94` | `toolNames` filters `name !== OTHERS_TOOL_KEY` **before** `.slice(0, 3)` — the ordering that makes the ≥3-real-name case correct |
| `95-104` | `toolCallTotal` sums bucket counts while skipping the sentinel, so the sentinel can never make a zero period look non-empty |
| `188-202` | `series: toolCallTotal === 0 ? [] : toolNames.map(…)`, plus `emptyMessage: "해당 기간에 tool 호출이 없습니다."` |
| `270-272` | `all` is derived from `spec.series`, so an empty series list yields `all.length === 0` |
| `347-352` | `all.length === 0` renders `<div className="chart-empty">{spec.emptyMessage}</div>` |
| `353-380` | the `else` branch renders `.chart-area`, which is the sole container of the `<svg>` (`380-432`) — no SVG exists outside it |
| `452-461` | the `.chart-legend` **container** is gated on `spec.series.length`, so neither the container nor any `.legend-item` renders when the list is empty |

`toolColor` (`78-82`) still maps retriever → `#10a77f` green, search → `#d8841c`
orange, http → `#7859d6` violet, matching the checklist's tool-colour requirement.

The filter-before-slice ordering is what makes the three named cases correct:

| distinct real tool names | bucket keys | `toolNames` after filter+slice | sentinel rendered |
| --- | --- | --- | --- |
| 0 | `["__others__"]` | `[]` (and `toolCallTotal === 0` → `series: []`) | **no** |
| 1 | `["retriever","__others__"]` | `["retriever"]` | **no** |
| 2 | `["retriever","search","__others__"]` | `["retriever","search"]` | **no** |
| ≥3 | `["retriever","search","http","grep","__others__"]` | `["retriever","search","http"]` | **no** |

### 3.3 Focused test verification

`web/src/overview/OverviewView.test.tsx`, `describe("Overview Tool Calls chart")`
(lines `177-258`), driven through the real component with `getDashboard` mocked to
return full server-shaped payloads built by `dashboardWithTools` (`41-71`). The
`legendLabels` helper (`80-84`) is a real DOM query
(`card.querySelectorAll(".legend-item")`), not a stub.

| Test | Input | Assertions |
| --- | --- | --- |
| *"explains the empty period instead of drawing the `__others__` sentinel"* | `[{__others__:0},{__others__:0}]` | `getByText("해당 기간에 tool 호출이 없습니다.")`; `legendLabels === []`; `card.querySelector("svg") === null`; `document.body.textContent` does not contain `__others__`; **and** traceCount still has 2 legend items, latency 3, errorRate 1, llmCalls 1 |
| *"renders only the real tool name when one name accompanies the sentinel"* | `{retriever, __others__:0}` ×2 | `legendLabels === ["retriever"]`; svg present; no empty text; no `__others__` |
| *"renders only the real tool names when two names accompany the sentinel"* | `{retriever, search, __others__:0}` ×2 | `legendLabels === ["retriever","search"]`; svg present; no empty text; no `__others__` |
| *"keeps the first three real tool names when more names are reported"* | `{retriever, search, http, grep, __others__:0}` ×2 | `legendLabels === ["retriever","search","http"]`; svg present; body does not contain `grep`; body does not contain `__others__` |

```console
$ cd web && npm test -- --run src/overview/OverviewView.test.tsx
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

The zero-tool test also pins the four sibling charts, so a future regression that
suppressed all legends would fail rather than pass silently.

### 3.4 Live verification — desktop 1280

`req 29498202-2111-488c-bb18-33a0b3e92e88`, `/?view=overview`, viewport asserted
`innerWidth === 1280`, against the live zero-tool API of §3.1:

```json
{"w":1280,
 "title":"Tool Calls",
 "emptyText":"해당 기간에 tool 호출이 없습니다.",
 "legendContainers":0,
 "legendItems":0,
 "svgCount":0,
 "pathCount":0,
 "chartAreaCount":0,
 "cardText":"Tool Calls 도구별 호출 실시간 해당 기간에 tool 호출이 없습니다.",
 "bodyHasOthers":false,
 "bodyHasOthersInHTML":false}
```

Every requirement is met exactly:

- the empty explanation is **exactly** `해당 기간에 tool 호출이 없습니다.`
- **no** `__others__` text — checked against both `document.body.textContent` and
  the full `document.documentElement.outerHTML`, so the sentinel is absent from
  attributes and `key`-derived markup as well, not merely from visible text
- **zero** `.chart-legend` containers and **zero** `.legend-item` elements
- **zero** `<svg>` and **zero** `<path>` elements in the card, and zero
  `.chart-area` containers

No collateral damage to the rest of the board — `req 2ca6e4a5-a9fc-4bc9-b474-f749862acf1c`:

```text
traceCount  legend=['Success','Error']    svg=1  empty=None
latency     legend=['p50','p95','p99']    svg=1  empty=None
errorRate   legend=['Error rate']         svg=1  empty=None
llmCalls    legend=['LLM']                svg=1  empty=None
toolCalls   legend=[]                     svg=0  empty='해당 기간에 tool 호출이 없습니다.'
```

All five source charts are still present in the source order and spans; only Tool
Calls shows the empty explanation.

### 3.5 Live verification — approximately 390px

`req f54f52a7-6d41-44c1-a357-14874cd6d923`, iPhone 12 emulation asserted
`innerWidth === 390`, `innerHeight === 844`, `devicePixelRatio === 3`:

```json
{"w":390,"h":844,"dpr":3,
 "emptyText":"해당 기간에 tool 호출이 없습니다.",
 "legendContainers":0,"legendItems":0,
 "svgCount":0,"pathCount":0,"chartAreaCount":0,
 "bodyHasOthers":false,"htmlHasOthers":false,
 "overflow":false,"cards":5}
```

Identical outcome at mobile width, with all five cards retained and no page-level
horizontal overflow.

### 3.6 Console and failed-network verification

| Viewport | Console errors/warnings | HTTP ≥ 400 | Request |
| --- | --- | --- | --- |
| 390 (Overview) | `[]` | `[]` | `1ce3093c-60ab-493d-964d-1c8db852ded7` |
| 390 (six-route loop) | `[]` | `0` | `518ac0d1-2e30-4eb2-8c67-b19d45c456c1` |
| 1280 (six-route loop) | `[]` | `[]` (46 resources) | `d00779ef-23cb-4bdc-ac85-c293fcb365a6` |
| 1280 (Traces + full drawer/picker/Escape flow) | `[]` | — | `49d45b2e-a17e-4874-97fc-d67edc88dadd` |
| 1280 (Overview + full recent-trace flow) | `[]` | — | `31b19ed0-9851-4c91-806d-d43c5d7778c6` |

Fetch ledger at 390 (`req 1ce3093c-…`): `dashboard->0, traces->0, traces->200,
dashboard->200`. The two status-`0` entries are the React 18 StrictMode
double-effect fetches cancelled by `AbortController`; both endpoints also completed
200. No request returned 400 or above anywhere in this audit.

---

## 4. Automated gates

Run from the repository root in this worktree.

| Command | Result |
| --- | --- |
| `cd web && npm test -- --run src/overview/OverviewView.test.tsx` | **Pass** — 1 file, **6 tests** (includes the 4 new tool-series tests) |
| `npm run lint --prefix web` | **Pass** (eslint, exit 0, no output) |
| `cd web && npm run typecheck` | **Pass** (`tsc -b --pretty false`, exit 0) |
| `cd web && npm test -- --run` | **Pass** — 8 files, **41 tests**, 0 failures (2.08s) |
| `cd web && npm run build` | **Pass** — 42 modules, `index-C65n958x.css` 35.14 kB, `index-yhPRhZu-.js` 285.54 kB |
| `git diff --check` | **Pass** (exit 0) |
| Impeccable detector | **Pass** — `[]` |

The full suite grew from 37 to **41 tests**, matching the four added Tool Calls
cases; no previously passing test was removed or weakened.

Detector run over all V2 implementation files including the changed test file, and
**without** the `--no-advisory` suppression:

```bash
node /Users/sungjin/.agents/skills/impeccable/scripts/detect.mjs --json \
  web/src/App.tsx web/src/overview/OverviewView.tsx web/src/overview/OverviewView.test.tsx \
  web/src/traces/TracesView.tsx web/src/styles.css web/src/components.tsx \
  web/src/annotations/QueuesView.tsx web/src/scores/ScoresView.tsx \
  web/src/evaluation/EvaluationView.tsx web/src/settings/LocalDataView.tsx \
  web/src/graph/RuntimeGraphView.tsx
# -> []
```

---

## 5. Narrow regression pass

Confined to establishing that the four original P1s and the Recent Traces
requirement remain resolved. No exploratory work beyond that.

### 5.1 P1-01 — Overview chart navigator — still resolved

| Check | Result | Request |
| --- | --- | --- |
| Initial state | `Trace Count=true`, all others `false` | `ac189fdc-42ef-4f8d-89a8-301b45351f6e` |
| Activation moves selected state | `Error Rate=true`, all others `false` | click `239ee2fa-b998-4db0-9a85-71fdce3b433d`, state `3747aae3-c430-4f3b-b1f3-8dc65d5c1c3e` |
| Announcement | `"Trace Error Rate 차트로 이동"`, `role=status`, `aria-live=polite` | `3747aae3-…` |
| Highlight | `chart-highlight` on `[data-chart=errorRate]` | `3747aae3-…` |
| Normal-motion scroll | `{behavior:"smooth", block:"center"}` | `3747aae3-…` |
| **Reduced-motion scroll, actually exercised** | `{behavior:"auto", block:"center"}` | media set, assert `755f8942-b2b8-4899-b2c9-1766faadb093` (`rm:true`, `noPref:false`), click `29e90b7b-8bb1-432c-94fb-94302e639595`, state `d6f8a732-ae29-41f0-9731-732f0ae56756` |

Reduced-motion emulation was genuine, not stubbed: both
`matchMedia('(prefers-reduced-motion: reduce)').matches === true` **and**
`matchMedia('(prefers-reduced-motion: no-preference)').matches === false`. Reset
to `rm:false` was verified afterwards. Activations were real mouse
`move`/`down`/`up` at the buttons' measured centres.

### 5.2 P1-02 — Traces filter composition and geometry — still resolved

`req 40cc74a3-363a-4dad-8b2f-8336cf5b545f`, `innerWidth === 1280`:

```json
{"w":1280,
 "fields":["검색","상태","기간","태그"],
 "controls":4,
 "buttons":["적용[submit]","초기화[reset]"],
 "grid":"471.852px 191.695px 191.695px 191.688px 45.625px 56.4453px",
 "gap":"9px","padding":"14px"}
```

Exactly the source four fields, in source order, with the source `적용`/`초기화`
pair. Grid, gap and padding are byte-identical to the values measured in
`FIDELITY_REAUDIT.md` §3.4 against the reference (`fr` ratio 2.4614 versus the
source's `1.6fr : 0.65fr` = 2.4615).

### 5.3 P1-03 — Mobile wordmark scoping — still resolved

`req 518ac0d1-2e30-4eb2-8c67-b19d45c456c1`, six-route SPA loop at
`innerWidth === 390`:

```text
Overview           wordmark=0px    w=0    overflow=false
Traces             wordmark=0px    w=0    overflow=false
Annotation Queues  wordmark=14px   w=85   overflow=false
Scores             wordmark=14px   w=85   overflow=false
Evaluation         wordmark=14px   w=85   overflow=false
Setting            wordmark=14px   w=85   overflow=false
console: []   HTTP>=400: 0
```

Hidden only on Overview and Traces — matching the two references that carry
`.brand { font-size: 0 }` at `≤520px` — and retained on the four management
references that carry no such rule.

### 5.4 P1-04 — Traces Add-to-queue Escape layering — still resolved

| Step | Result | Request |
| --- | --- | --- |
| Open drawer from row (Enter) | drawer open, `trace=tr_audit_001` | — |
| Open `Trace 작업` menu (real Enter keypress) | menu open, items `Add to queue / Add to dataset / Delete trace`, `aria-expanded=true` | `29acab7e-…` / state `85376528-c99d-44f7-91c7-4ca9001b62f0` |
| Open `Add to queue` (real Enter keypress) | `lf-modal` titled **"Add to queue"** open; **menu already closed**, `aria-expanded=false`; drawer open | `1c6798eb-…` / state `fdb3ad41-09c9-48df-aba4-7ecf611bdf1c` |
| **Escape #1** | modal gone, menu closed, `aria-expanded=false`, **drawer still open**, `trace=` still in URL | `be91e756-…` / state `2a3e2837-3ce2-403d-ac96-571c20ea543f` |
| **Escape #2** | **drawer closed**, `trace=` removed, **focus on `<tr data-trace-id="tr_audit_001">`**, console `[]` | `4b2c63c6-…` / state `49d45b2e-a17e-4874-97fc-d67edc88dadd` |

Exactly two Escapes; no hidden menu state survives between the picker and the
drawer.

### 5.5 Overview Recent Traces — still resolved

All at `innerWidth === 1280`, row `tr_audit_001`.

| Check | Result | Request |
| --- | --- | --- |
| Mouse click opens the detail | drawer open, width **760px** | real `mouse move/down/up` `fa0aeb86-c2bd-4bdd-b295-e623c71e20e1`, state `439b0c56-60aa-4ea4-bfb2-1d49e828802d` |
| URL reflects the trace | `trace=tr_audit_001`; row `aria-selected="true"` | `439b0c56-…` |
| Graph renders from the real contract | 3 nodes `obs_audit_root`, `obs_audit_retriever`, `obs_audit_llm`; 2 `runtime-edge`; heading `실행 흐름` | `439b0c56-…` |
| Input/Output renders from the real contract | `policy-rag · Input / Output`; `{"question":"서울 청년 월세 지원"}` / `{"answer":"신청 조건을 확인해 보세요."}` | `439b0c56-…` |
| Escape closes and restores focus | drawer closed, `trace=` cleared, `activeRowId === "tr_audit_001"` | `9b41b962-0908-4b69-b7a5-6560bae9a565` |
| Enter opens the detail | drawer open, `trace=` set, 3 graph nodes | `44fd3a58-66ae-4150-9c4f-d5876d7ad85a` |
| **Space opens the detail** (real keypress) | pre-state closed with focus on row (`c91b734a-61f9-4246-adba-8d956ff73149`), then open with `trace=` and 3 graph nodes | `31b19ed0-9851-4c91-806d-d43c5d7778c6` |
| Space does not scroll the page | `scrollY` 639 → 639 (`preventDefault` honoured) | `c91b734a-…` / `31b19ed0-…` |

---

## 6. P2-R01 — documented, unchanged, non-blocking

Shared control and brand tokens still collapse four reference-specific systems into
two. Verified unchanged: `web/src/styles.css:270` still sets `.lf-btn { font-size:
12.5px }`, and `styles.css:273-277` still applies `min-height: 33px` / `radius 5px`
to all four management surfaces.

| Surface | Reference value | Implementation | Delta |
| --- | --- | --- | --- |
| Traces | `.btn font-size 12px` | 12.5px | +0.5px type |
| Scores | `.btn min-height 34px`, `radius 6px` | 33px / 5px | −1px height, −1px radius |
| Queues | `.btn min-height 32px` | 33px | +1px height |
| Queues wordmark | `.brand font-size 15px` | 14px | −1px type |

These do not alter hierarchy, density perception, or any interaction, so they
remain P2 under the checklist rubric. The acceptance rule permits documented P2
findings to remain open. Recommended for the next pass over the management
surfaces, not a condition of acceptance.

---

## 7. Verification limits

Recorded as limits, not as passes.

1. **Screenshots unavailable.** `Page.captureScreenshot` failed throughout this
   audit with `"Screenshot timed out — the browser tab may not be visible or the
   window may not have focus"`, at both 1280 and 390. All claims here are
   therefore anchored on measured DOM/CSSOM state, which is stricter than a pixel
   comparison for the specific assertions made (element counts, exact text,
   computed colours and geometry). The checklist's separate "screenshot evidence
   for all six screens at desktop and mobile" requirement is **not** satisfied by
   this session; `FIDELITY_AUDIT.md` retains the prior sessions' screenshot IDs for
   it.
2. **Suspended compositing in the non-visible tab.** With the browser window not
   visible, CSS transitions do not advance: the trace drawer was observed holding
   `transform: matrix(1,0,0,1,782.8,0)` while `.trace-drawer.is-open` was correctly
   set and its content fully rendered (`req 69e1bc46-964e-4dda-9c6d-60bc8925180c`).
   This is a rendering-suspension artifact of the headless/backgrounded tab, **not**
   a product defect — the class and content state were correct throughout. Because
   it makes coordinate hit-testing unreliable, §5.4 was driven with real `Enter`
   keypresses on focused controls rather than pixel clicks; every activation was
   still a genuine key event, and all assertions are on DOM state.
3. **Console capture window.** Console wrappers are installed immediately after each
   page load, so the first milliseconds of React's initial mount are unwrapped. This
   was mitigated by full six-route SPA loops at both viewports, under which every
   view mounts while instrumented. Network coverage has no such gap —
   `PerformanceResourceTiming` spans the entire timeline including initial load.
4. **Puppeteer-backed URL form of the Impeccable detector** remains unavailable in
   this workspace. The static file-target form specified by this task ran clean.
5. **Reference integrity** is a session SHA-256 comparison; the V2 files are
   untracked, so no committed-Git baseline exists to diff against.

---

## 8. Final acceptance decision

**ACCEPTED.**

- **P0 open: 0.**
- **P1 open: 0.** `P1-R01` is resolved — verified by source ordering
  (filter-before-slice), by four focused tests covering the 0 / 1 / 2 / ≥3
  real-tool-name cases, and by live rendering at desktop 1280 and 390px against the
  real server response that still returns `tool_calls: {"__others__": 0}`. The card
  shows exactly `해당 기간에 tool 호출이 없습니다.` with zero legend containers,
  zero legend items, zero `<svg>`, zero `<path>`, and no `__others__` anywhere in
  the serialized document. The four original P1s and the Overview Recent Traces
  behaviour are confirmed free of regression.
- **P2 open: 1.** `P2-R01`, documented above; permitted to remain.
- All automated gates pass: lint, typecheck, 8 files / 41 tests, build,
  `git diff --check`, and the Impeccable detector returning `[]` without advisory
  suppression.
- Console is clean and no HTTP response of 400 or above occurred on any of the six
  routes at either viewport.
- V2 reference checksums are byte-identical before and after.

The V2 implementation meets the acceptance bar defined in
`IMPLEMENTATION_CHECKLIST.md`, subject to the screenshot-evidence limit recorded in
§7.1, which is an environment constraint of this session rather than an
implementation defect.

No product code, no `design-explorations/v2/*-light.html` reference, and no prior
report was modified by this audit. The only file written is this one.
