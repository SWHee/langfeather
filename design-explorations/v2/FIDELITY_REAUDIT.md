# V2 Fidelity Re-Audit

**Re-audit date:** 2026-08-02
**Auditor:** independent reviewer (Claude Opus 5), terminal `term_4de3b521-dd01-4c99-997a-af7d16ac7b7a`
**Scope:** state audit of the V2 React implementation after remediation task
`task_21a66f405518`
**Result:** **NOT ACCEPTED — P0: 0, P1: 1 open, P2: 1**

The six `design-explorations/v2/*-light.html` files are the sole visual authority.
Every claim below was re-derived from those files and from the running
implementation. Implementer claims in
`/private/tmp/langfeather-task_21a66f405518-remediation-report.md` were treated as
hypotheses to test, not as evidence.

The four originally-blocking P1 findings in `FIDELITY_AUDIT.md` are all
**independently confirmed resolved**, and the new Overview Recent Traces
requirement **passes in full**. Acceptance is nonetheless withheld because this
re-audit independently reproduced one previously unrecorded P1 on the Overview
Tool Calls chart.

---

## 1. Method

### 1.1 Environments

| Component | Address | Notes |
| --- | --- | --- |
| V2 references | `http://127.0.0.1:4321/<file>.html` | static server, files served byte-for-byte |
| React implementation | `http://127.0.0.1:5174/?view=<view>` | Vite dev server, proxies `/api/v1/*` |
| Real server API | `http://127.0.0.1:8000/api/v1/*` | live LangFeather server with an audit fixture |

The API fixture contains a real trace `tr_audit_001` (`policy-rag`, session
`session_audit`, 3 observations: `obs_audit_root` chain, `obs_audit_retriever`,
`obs_audit_llm`). All drawer/graph/payload evidence below is rendered from that
real server response, not from demo constants.

### 1.2 Viewports

- Desktop: `orca exec --command "set viewport 1280 900 1"` → verified
  `innerWidth === 1280`.
- Mobile: `orca exec --command 'set device "iPhone 12"'` → verified
  `innerWidth === 390`, `innerHeight === 844`, `devicePixelRatio === 3`.

**Reproducibility note:** `orca goto` and `orca reload` both reset viewport/device
emulation. Emulation was therefore re-applied and re-asserted after every
navigation; each measurement below reports the `innerWidth` it was taken at.

### 1.3 Reduced motion

`orca exec --command "set media reduced-motion"` produced genuine browser-applied
emulation in this session:

```text
req 07bd0e38-ef3f-4de6-a260-99c050740f13   set media reduced-motion  ok
req fdc7c16c-6d18-49d6-936e-e0d696d47934   {"rm":true,"noPref":false,"w":1280}
```

Both `matchMedia('(prefers-reduced-motion: reduce)').matches === true` **and**
`matchMedia('(prefers-reduced-motion: no-preference)').matches === false`. This
resolves the "Inconclusive" reduced-motion row in `FIDELITY_AUDIT.md`: the
reduced-motion branch below was **actually exercised**, not stubbed. Reset was
verified afterwards (`req a862f5ac-bd3b-4c2e-87bc-9f5a79fec5ac` → `rm:false`).

### 1.4 Console and network capture

- Console: `console.error` / `console.warn` / `window.onerror` /
  `unhandledrejection` were wrapped immediately after each page load, then a full
  six-route SPA navigation loop plus every audited interaction was executed.
- Network: `PerformanceResourceTiming.responseStatus` over
  `performance.getEntriesByType("resource")`. This covers the **complete**
  resource timeline including requests issued before instrumentation.

---

## 2. Reference integrity and audit boundary

| Check | Result | Evidence |
| --- | --- | --- |
| V2 reference SHA-256 before audit | recorded | see block below |
| V2 reference SHA-256 after audit | **identical** | see block below |
| Product code modified by this audit | **No** | `git status --short web/src` unchanged from session start |
| V2 `*-light.html` modified by this audit | **No** | checksums identical; audit wrote only this file |
| `git diff --check` | Pass (exit 0) | run at §6 |
| Build artifacts dirtying the tree | No | `web/dist/` is gitignored (`.gitignore:20`) |

Reference SHA-256, **identical before and after** this re-audit, and identical to
the values recorded in both `FIDELITY_AUDIT.md` and the remediation report:

```text
4e95af98b44c3c37b90b79201e06472148d5de1d712b7fb73d4904cb2402008d  claude-annotation-queues-light.html
0ce2ab086ea25f89d1aed7529a7d6854e3879fc80ffd82fc838b95b8d5740717  claude-evaluation-light.html
de59a9e7fb2016f5fede119f68f29b32f33878f8fa5a4271211d1f942c5528a8  claude-modular-observatory-light.html
0ab5b6b64b4baa6b248a8057a411fe593b9face3bdb32ae05cbe35c54c5410c0  claude-scores-light.html
22b658eca7f58782e0ab5ea784a41e325bfd5bb8376925a6bb978e5672ac4c4d  claude-settings-light.html
2bd06bb6114ada42bb3f4c2494229aa2c848399b94ddddde80baf9650f55c881  claude-traces-workspace-light.html
```

The references are untracked in this worktree, so this is a session-integrity
check, not a committed-Git-baseline comparison — the same caveat recorded by the
original audit.

---

## 3. Findings

### 3.1 Severity table

| ID | Severity | Status | Surface | Summary |
| --- | --- | --- | --- | --- |
| — | **P0** | none found | — | No missing surface, no wrong navigation, no replaced information architecture, no legacy presentation reused as baseline |
| **P1-R01** | **P1** | **OPEN** | Overview | Tool Calls chart renders the server's internal `__others__` aggregation key as a user-facing zero-value series instead of the source's tool series / an explicit no-tool-calls state |
| P1-01 | P1 | **RESOLVED** | Overview | Chart navigator selected state, announcement, highlight, reduced-motion scroll |
| P1-02 | P1 | **RESOLVED** | Traces | Filter composition and desktop/mobile geometry |
| P1-03 | P1 | **RESOLVED** | Global shell | Mobile wordmark scoping |
| P1-04 | P1 | **RESOLVED** | Traces | Add-to-queue Escape layering and focus restore |
| **P2-R01** | **P2** | OPEN | Traces / Scores / Queues | Shared `.lf-btn` and wordmark tokens collapse four reference-specific control systems into two; measured deltas are 0.5px type, 1–2px height/radius, ~1px grid track |

### 3.2 P1-R01 — Overview Tool Calls chart renders the internal `__others__` key as a visible series *(OPEN — blocks acceptance)*

**Checklist impact:** Authority item 4 ("Non-visual API and data contracts may be
reused only to connect the new UI to the real server. **They must not change the
visible composition of a V2 screen.**"); Overview — "Tool colors are retriever
green, search orange, http violet"; global — "loading, empty, error, disabled
states are designed together".

**Also violates a named product spec:** `specs/web-functional.md:60` —
> tool call total이 0이면 `__others__ = 0` 같은 가짜 series를 그리지 않고 해당
> 기간에 tool 호출이 없음을 설명한다.

(«If the tool call total is 0, do not draw a fake series such as `__others__ = 0`;
explain that there were no tool calls in that period.»)

**Expected from the reference.** `claude-modular-observatory-light.html` Tool Calls
card carries the subtitle `도구별 호출` («calls by tool») and three named tool
series. Measured live at 1280 (`req 8da4f4c2-d7ab-408f-8091-6ef8306244c9`):

```text
title  = Tool Calls
legend = ["retriever", "search", "http"]
tag    = 예시
```

**Actual React behaviour.** Measured live at desktop 1280
(`req 5cf63dd3-43b1-4b50-8973-08175ad85b70`, detail `req 04c5d864-f528-45fa-86bc-daabcb0a484d`):

```text
title      = Tool Calls
sub        = 도구별 호출
legend     = ["__others__"]
legendDot  = rgb(22, 59, 112)      // #163b70 — the Latency p50 / LLM Calls navy, not a tool colour
svg path   = M0.00,100.00L14.29,100.00L28.57,100.00 … (flat zero baseline)
emptyState = false
cardText   = "Tool Calls 도구별 호출 실시간 __others__"
```

No empty state is offered; the user is shown a chart whose only series is an
internal server sentinel with a constant value of zero.

**Root cause, both sides of the contract.**

- `server/src/langfeather_server/repository.py:1164-1170` — when no tools are
  explicitly selected, the server *always* appends `"__others__"` to
  `tool_series` and writes it into every bucket.
- `web/src/overview/OverviewView.tsx:85-87,176-180` — `specsFor` derives series
  names from `Object.keys(bucket.tool_calls)` and takes `.slice(0, 3)`, with no
  filter for the sentinel and no zero-total empty state.

Live API confirmation against the real server:

```console
$ curl -s "http://127.0.0.1:8000/api/v1/dashboard?from=2026-07-26T00:00:00Z&to=2026-08-02T23:59:59Z&timezone=UTC"
totals.tool_calls        = 0
available_tools          = []
bucket tool_calls keys   = ['__others__']
first bucket tool_calls  = {'__others__': 0}
```

**Exact trigger condition** (verified by replaying the server key ordering through
the client `.slice(0, 3)`):

| distinct tool names in window | bucket keys | rendered series | `__others__` visible |
| --- | --- | --- | --- |
| 0 | `["__others__"]` | `["__others__"]` | **yes** |
| 1 | `["t1","__others__"]` | `["t1","__others__"]` | **yes** |
| 2 | `["t1","t2","__others__"]` | `["t1","t2","__others__"]` | **yes** |
| 3 | `["t1","t2","t3","__others__"]` | `["t1","t2","t3"]` | no |
| ≥4 | `[…,"__others__"]` | first 3 real tools | no |

The defect is therefore visible whenever a window contains **fewer than three
distinct tool names** — the common case for a single-project local-first tool, and
the exact case of the current audit fixture. A fix validated only against a
three-tool fixture will not exercise it.

**Reproduction:**

1. Serve the React app against a server whose dashboard window contains 0–2
   distinct tool names.
2. Open `/?view=overview` at any viewport.
3. Read the Tool Calls card legend.

**Disposition:** pre-existing rather than introduced by the remediation, which does
not reduce severity in a state audit. It is a P1 because it is a chart-semantics
and visible-composition difference driven by a non-visual API detail, forbidden by
Authority item 4 and by `specs/web-functional.md:60` by name.

### 3.3 P1-01 — Overview chart navigator — **RESOLVED**

**Reference behaviour** (`claude-modular-observatory-light.html:1085-1113`):
`jumpToChart` sets `aria-current` to `String(button.dataset.chartJump === chartId)`
on *every* navigator button, calls
`scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" })`,
and after `reducedMotion ? 0 : 260` ms removes/re-adds `chart-highlight` and writes
`<h3> + " 차트로 이동"` into `#chartAnnounce` (`role="status"`, `aria-live="polite"`,
lines 1053-1058).

**Implementation** (`web/src/overview/OverviewView.tsx:644-672`, `826-836`,
`972-974`) matches structurally. `.traffic-card.chart-highlight` and the
`@keyframes chart-highlight` block are byte-identical between
`claude-modular-observatory-light.html:511-527` and `web/src/styles.css:598-615`.

| Sub-requirement | Result | Evidence (desktop 1280) |
| --- | --- | --- |
| Initial selected state | Pass — `Trace Count=true`, all others `false` | `req 5cf63dd3-43b1-4b50-8973-08175ad85b70` |
| Selected state moves on activation | Pass — `Latency=true`, all others `false` | click `req 0edea6a4-5dbf-41b6-8241-a2c749192b66`, state `req f7ac51fa-8e1d-4a66-96ed-f7cfb9727053` |
| Announcement | Pass — `"Trace Latency 차트로 이동"`, `role=status`, `aria-live=polite` | `req f7ac51fa-8e1d-4a66-96ed-f7cfb9727053` |
| Highlight | Pass — `chart-highlight` on `[data-chart=latency]` | `req f7ac51fa-8e1d-4a66-96ed-f7cfb9727053` |
| Normal-motion scroll | Pass — `{behavior:"smooth", block:"center"}` | `req f7ac51fa-8e1d-4a66-96ed-f7cfb9727053` |
| **Reduced-motion scroll (actually exercised)** | **Pass — `{behavior:"auto", block:"center"}`** | media `req 07bd0e38-…`, assert `req fdc7c16c-…` (`rm:true`), click `req cae7bfae-9cb3-4702-84f0-a16155d2383a`, state `req 119888a5-de14-44ea-8fc3-b2d7c94c2383` |

Reduced-motion state capture (`req 119888a5-de14-44ea-8fc3-b2d7c94c2383`):

```json
{"w":1280,"rm":true,
 "siv":[{"chart":"toolCalls","arg":{"behavior":"auto","block":"center"}}],
 "nav":["Trace Count=false","Latency=false","Error Rate=false","LLM Calls=false","Tool Calls=true"],
 "announce":"Tool Calls 차트로 이동","highlight":["latency","toolCalls"]}
```

`scrollIntoView` was captured by wrapping `Element.prototype.scrollIntoView`; every
activation was a real mouse `move`/`down`/`up` on the button's measured centre, not
a synthetic `dispatchEvent`.

A corroborating mobile-width run recorded the same reduced-motion `auto` branch
with a measured announcement latency of **23 ms** (versus the 260 ms non-reduced
timer): `req f075ff16-9982-4355-b8af-e257e57a5ce6`.

The implementation reads `matchMedia` per invocation whereas the reference caches
it once at script init. That is a superset of the source behaviour (it also honours
a mid-session preference change) and is not recorded as a difference.

### 3.4 P1-02 — Traces filter composition and geometry — **RESOLVED**

**Reference** (`claude-traces-workspace-light.html:944-975`, CSS `172-204`): exactly
four fields — `검색` (search input), `상태` (select), `기간` (relative period
select), `태그` (text input) — followed by `적용` (submit) and `초기화` (reset).

**Implementation** (`web/src/traces/TracesView.tsx:646-708`, CSS
`web/src/styles.css:918-953`): identical composition and order. The previously
reported start/end datetime and Session ID fields are gone; they remain non-visual
query state only.

**Desktop 1280, measured side by side:**

| Metric | Reference `req 9a6b3910-860d-446e-b181-b15ff2b4a759` | React `req 171975db-f93f-4a55-b580-dadcbb648280` |
| --- | --- | --- |
| visible controls | 4 | 4 |
| fields | 검색/search, 상태/select, 기간/select, 태그/text | identical |
| buttons | `적용[submit]`, `초기화[reset]` | identical |
| `grid-template-columns` | `472.83 192.09 192.09 192.09 44.77 55.15` | `471.85 191.70 191.70 191.69 45.63 56.45` |
| wide-track ratio | 472.83 / 192.09 = **2.4615** | 471.85 / 191.70 = **2.4614** (source `1.6fr : 0.65fr` = 2.4615) |
| `gap` / `padding` | `9px` / `14px` | `9px` / `14px` |
| control height / button height | `34px` / `34px` | `34px` / `34px` |
| page horizontal overflow | none | none |

**Mobile 390, measured side by side:**

| Metric | Reference `req 07831e0b-ff50-4c95-b366-0f2c41232b43` | React `req 6686c23b-2280-494b-b327-66ac080fe113` |
| --- | --- | --- |
| `grid-template-columns` | `328px` | `328px` |
| first field `grid-column` | `auto` | `auto` |
| `gap` / `padding` | `9px` / `14px` | `9px` / `14px` |
| **filter panel height** | **360px** | **360px** |
| control height | `34px` | `34px` |
| topbar height | `52px` | `52px` |
| horizontal overflow | none | none |

The 820px and 520px responsive rules also match the source
(`web/src/styles.css:2276-2281, 2389-2394` versus
`claude-traces-workspace-light.html:848-853, 879-884`).

The residual ~1px grid-track difference is attributable to P2-R01 and is recorded
there, not here.

### 3.5 P1-03 — Mobile wordmark scoping — **RESOLVED**

**Reference truth, verified at source and live.** Only the Overview and Traces
references hide the wordmark, via `.brand { font-size: 0 }` inside
`@media (max-width: 520px)`
(`claude-modular-observatory-light.html:636-640`,
`claude-traces-workspace-light.html:864-868`). The four management references —
Queues (`850px`), Scores (`700px`), Evaluation (`850px`), Settings (`640px`) —
contain **no** rule that hides the brand.

Live reference measurements at 390:

| Reference | font-size | text shown | request |
| --- | --- | --- | --- |
| modular-observatory | `0px` | no | `582b431d-78ad-4e0a-a946-1850fb8252e4` |
| traces-workspace | `0px` | no | `1bcd1eaa-3fb9-4fe0-a22c-2422756bb57d` |
| annotation-queues | `15px` | yes | `0153273d-9af6-4c5d-9261-7f3222e24ebc` |
| scores | `14px` | yes | `e34f42d4-514c-486f-afa9-74ce5f0cf5ed` |
| evaluation | `14px` | yes | `c1b89f55-2693-4ecf-a98f-e6bc682964c8` |
| settings | `14px` | yes | `6fd3c556-f6e0-4267-8c3f-bbbd78279925` |

**Implementation.** `web/src/styles.css:2331-2338` now scopes the rule to
`.surface-overview .lf-wordmark, .surface-traces .lf-wordmark`. Six-route loop at
`innerWidth === 390` (`req c1856759-ea38-4f2b-b77d-8d7d7febf66c`, re-confirmed in
`req e469c6dd-afc2-4ba7-8841-0394dc7a65a6`):

```text
overview   surface-overview   font=0px    width=0       hidden   overflow=false
traces     surface-traces     font=0px    width=0       hidden   overflow=false
queues     surface-queues     font=14px   width=84.98   visible  overflow=false
scores     surface-scores     font=14px   width=84.98   visible  overflow=false
datasets   surface-datasets   font=14px   width=84.98   visible  overflow=false
data       surface-data       font=14px   width=84.98   visible  overflow=false
```

The hide/show axis matches all six references exactly. The Queues wordmark size
delta (14px vs the reference's 15px) is recorded in P2-R01.

### 3.6 P1-04 — Traces Add-to-queue Escape layering — **RESOLVED**

**Reference behaviour** (`claude-traces-workspace-light.html:1520-1524`,
`1851-1860`, `1884-1904`): opening the queue picker sets `traceActionMenu.hidden =
true`; the first Escape matches `!queuePicker.hidden` and calls
`closeTraceActions()`, which clears menu + picker + delete-confirm together; the
next Escape matches `body.classList.contains("drawer-open")` and calls `shut()`,
which restores focus via `lastTrigger.focus()` (line 1708).

**Implementation** (`web/src/traces/TracesView.tsx:500-504` `openTargets` clears
`action`; `405-421` Escape priority; `371-380` focus restore).

**Exact live reproduction at desktop 1280:**

| Step | Action | Result | Request |
| --- | --- | --- | --- |
| 1 | focus row `tr_audit_001`, press Enter | drawer open, `trace=tr_audit_001` in URL | `f26458b7-…` / `0f2e3a94-…` / state `ec320899-3088-4cd0-92d0-4ceb99c95bb4` |
| 2 | click `Trace 작업` | menu open, items `Add to queue / Add to dataset / Delete trace`, `aria-expanded=true` | `79864241-…` / state `aa64355d-cc9c-4def-9ff5-4929a8841123` |
| 3 | click `Add to queue` | `lf-modal` "Add to queue" open; **menu already closed**, `aria-expanded=false` | `8d8af924-…` / state `a52d95a5-8bd1-41d5-b0f9-3e7e0033f045` |
| 4 | **Escape #1** | picker gone, menu closed, `aria-expanded=false`, **drawer still open**, `trace=` still in URL | `bb85609c-…` / state `6219a58f-0505-4b74-b492-db18d3f6bc0c` |
| 5 | **Escape #2** | **drawer closed**, `trace=` removed from URL, **focus restored to `<tr data-trace-id="tr_audit_001">`** | `6d2bc084-…` / state `cf657fae-7eaf-45c6-8a00-67bdc4e67a34` |

State at step 3:

```json
{"dialogs":[{"cls":"trace-drawer is-open","label":"policy-rag"},
            {"cls":"lf-modal","label":"Add to queue"}],
 "menuOpen":false,"expanded":"false","drawerOpen":true}
```

State after step 5:

```json
{"drawerOpen":false,"traceInUrl":false,"activeTag":"TR",
 "activeIsTraceRow":true,"activeTraceId":"tr_audit_001"}
```

Exactly two Escapes. The third-Escape defect is gone.

**Adjacent check (not a finding).** `OverviewTraceDrawer`'s Escape handler
(`TracesView.tsx:1075-1079`) is unconditional, which would be the same defect class
if it had inner layers. It does not: the drawer is rendered with `readOnly`
(`TracesView.tsx:1170`), and every control that could set `action` or
`scorePickerOpen` — the `Trace 작업` button (`1299`), the action menu (`1318`), the
delete confirm (`1335`) and the annotation section containing the score picker
(`1425`) — is gated behind `!readOnly`. No inner layer can exist, so the
unconditional handler is correct for that surface.

### 3.7 New requirement — Overview Recent Traces open/close — **PASS**

Checklist line: *"A Recent Trace row opens the selected trace detail drawer/card by
pointer or Enter/Space, reflects the selected trace in URL state, and returns focus
to the originating row when Escape closes the detail."*

All measurements at desktop 1280 (`innerWidth` asserted in each capture);
`?view=overview`, row `tr_audit_001`.

| Sub-requirement | Result | Evidence |
| --- | --- | --- |
| Mouse click opens the detail | Pass | real `mouse move/down/up` at the row's measured centre — `0a1dce27-a26e-43e2-90c1-7c7d8aa4c599`; state `b8ebd90c-42f5-41ee-89c1-c433a2b49fd4` |
| Enter opens the detail | Pass | `601af39b-…`; state `280acdca-522f-4005-b999-413f99c6d3ce` |
| **Space opens the detail** | **Pass — real keypress** | pre-state `a8eb6d5c-402d-41f9-93d6-58b67ce8d6fb` (closed, focus on row); `orca keypress --key Space` `1b5d6309-be9e-42f5-a8a5-7582c9593031`; post-state `b0c7b28c-c339-4128-9a3a-12b7d4f569e4` |
| Space does not scroll the page | Pass | `scrollY` 638.5 → 638.5 across the press (`preventDefault` honoured) |
| URL state reflects the trace | Pass | `?view=overview&…&trace=tr_audit_001`; row `aria-selected="true"` |
| Graph renders from the real contract | Pass | 3 nodes `obs_audit_root`, `obs_audit_retriever`, `obs_audit_llm`; 2 `runtime-edge` elements; heading `실행 흐름` |
| Input/Output renders from the real contract | Pass | heading `policy-rag · Input / Output`; payloads `{"question":"서울 청년 월세 지원"}` and `{"answer":"신청 조건을 확인해 보세요."}` |
| Drawer width | Pass | 760px, matching the source drawer proportion |
| Escape closes and clears URL | Pass | `02025a9f-…`; state `591d7275-b92e-4a8d-9aee-c71cf13776ab` |
| **Escape restores focus to the originating row** | **Pass** | `activeIsRow:true`, `activeRowId:"tr_audit_001"`, `rowSelected:"false"` |

Full open-state capture (`req b8ebd90c-42f5-41ee-89c1-c433a2b49fd4`):

```json
{"w":1280,"drawerOpen":true,"drawerWidth":760,"traceInUrl":true,"rowSelected":"true",
 "graphNodes":3,"graphEdges":2,
 "nodeLabels":["obs_audit_root","obs_audit_retriever","obs_audit_llm"],
 "ioHeads":["실행 흐름","policy-rag · Input / Output"],
 "payload":["{ \"question\": \"서울 청년 월세 지원\" }","{ \"answer\": \"신청 조건을 확인해 보세요.\" }"]}
```

The same flow was independently exercised at a narrower viewport earlier in the
session with identical outcomes (open `ba991520-7329-42f4-bc3d-cc658d3bd221`,
Escape+focus `9acd189f-186a-4c97-854d-44d03c687860`, Enter
`17f62ac1-61a6-419f-ab59-711fd88a1227`, Space `dcd228f3-ec42-48b7-b342-d138263bf20f`).

**Note on prior evidence.** The handover recorded that Orca could not deliver a
Space keypress and that the Space branch was only probed with a synthetic
`key=" "` event. That limitation did not reproduce: `orca keypress --key Space`
delivers a real key event, and the Space branch is confirmed by genuine user-level
input.

### 3.8 P2-R01 — Shared control and brand tokens collapse reference-specific values *(OPEN, non-blocking)*

Found while re-measuring P1-02's geometry. The implementation uses two button
token sets where the references define four.

| Surface | Reference `.btn` / `.brand` | Implementation | Delta |
| --- | --- | --- | --- |
| Overview | `font-size 12.5px`, `min-height 34px`, `radius 6px` | same | — |
| **Traces** | `font-size 12px`, `height 34px`, `radius 6px` | `font-size 12.5px` (`styles.css:270`) | **+0.5px type** |
| **Scores** | `font-size 12px`, `min-height 34px`, `radius 6px` | `min-height 33px`, `radius 5px` (`styles.css:273-280`) | **−1px height, −1px radius** |
| **Queues** | `font-size 12px`, `min-height 32px`, `radius 5px` | `min-height 33px` | **+1px height** |
| Setting | `font-size 12px`, `min-height 33px`, `radius 5px` | same | — |
| **Queues wordmark** | `.brand { font-size: 15px }` (`claude-annotation-queues-light.html`) | 14px (no `.surface-queues` font-size override) | **−1px type** |

Measured effect on the audited surface (Traces filter panel, desktop 1280,
`req 7139d15c-d343-476e-bc30-2385f0f0153c` vs `req e860b657-203c-499a-a034-e6ffe028b646`):
the `적용` button computes to 45.63px wide against the reference's 44.77px
(identical `padding: 0 11px`, identical font family, `font-size` 12.5px vs 12px),
which propagates as roughly 1px narrower `fr` tracks across the panel.

**Severity rationale.** The checklist reserves P1 for *materially* different
geometry or typography and assigns P2 to "small spacing … or sub-pixel rendering
differences that do not alter hierarchy". A 0.5px type delta and 1–2px
height/radius deltas do not alter hierarchy, density perception, or any
interaction, so this is recorded as P2 with exact values rather than inflated to a
blocker. It is nonetheless a real departure from the checklist's "source-derived"
requirement for type sizes, radii and control heights, and should be fixed when the
management surfaces are next touched.

---

## 4. Runtime evidence — console, network, overflow

### 4.1 Desktop 1280, all six routes

`req 9740b536-e1b2-422c-922a-2b4dc327c158` — full SPA navigation loop:

```text
Overview           overflow=false
Traces             overflow=false
Annotation Queues  overflow=false
Scores             overflow=false
Evaluation         overflow=false
Setting            overflow=false
console errors/warnings : []
HTTP responses >= 400   : []
resource entries        : 40
```

### 4.2 Mobile 390, all six routes

`req e469c6dd-afc2-4ba7-8841-0394dc7a65a6`:

```text
Overview           wordmark=0px    overflow=false
Traces             wordmark=0px    overflow=false
Annotation Queues  wordmark=14px   overflow=false
Scores             wordmark=14px   overflow=false
Evaluation         wordmark=14px   overflow=false
Setting            wordmark=14px   overflow=false
console errors/warnings : []
HTTP responses >= 400   : []
```

### 4.3 Interaction-phase capture

Overview after the full recent-trace flow (`req 013b9be8-0a61-40e3-9540-30d5c2326f10`)
and Traces after the full queue-picker/Escape flow (`req 134955f3-1403-447c-b632-e06da0b9a451`):
console `[]`, HTTP `>= 400` `[]`.

### 4.4 Status-0 entries are not failures

Two resource entries report `responseStatus === 0`
(`req e628222f-7275-449a-ad03-fc939851fc0c`): the `/api/v1/dashboard` and
`/api/v1/traces` requests aborted by React 18 StrictMode's double-invoked effect
plus `AbortController`. The complete fetch ledger
(`req 26b42426-cfb5-49ee-90cb-b4c13d22ec73`) shows both endpoints subsequently
returning 200:

```text
dashboard -> 0, traces -> 0,
dashboard -> 200, traces -> 200,
traces/tr_audit_001 -> 200, observations/obs_audit_root -> 200  (×4)
```

No request returned a status of 400 or above at any point in this re-audit.

---

## 5. Route and viewport evidence index

| Surface | Reference route | React route | Desktop 1280 | Mobile 390 |
| --- | --- | --- | --- | --- |
| Overview | `/claude-modular-observatory-light.html` | `/?view=overview` | `5cf63dd3-…`, `f7ac51fa-…`, `119888a5-…`, `b8ebd90c-…`, screenshot `1297d832-4102-43dc-8d58-7bf00a791e8d` | `582b431d-…` (ref), `c1856759-…`, `e469c6dd-…` |
| Traces | `/claude-traces-workspace-light.html` | `/?view=traces` | ref `9a6b3910-…`, React `171975db-…`, Escape `6219a58f-…`/`cf657fae-…`, screenshot `160903a7-a5d1-4ab3-b2f9-d415a16f0f8b` | ref `07831e0b-…`/`1bcd1eaa-…`, React `6686c23b-…` |
| Annotation Queues | `/claude-annotation-queues-light.html` | `/?view=queues` | `9740b536-…` | ref `0153273d-…`, React `c1856759-…`/`e469c6dd-…` |
| Scores | `/claude-scores-light.html` | `/?view=scores` | `9740b536-…` | ref `e34f42d4-…`, React `c1856759-…`/`e469c6dd-…` |
| Evaluation | `/claude-evaluation-light.html` | `/?view=datasets` | `9740b536-…` | ref `c1b89f55-…`, React `c1856759-…`/`e469c6dd-…` |
| Setting | `/claude-settings-light.html` | `/?view=data` | `9740b536-…` | ref `6fd3c556-…`, React `c1856759-…`/`e469c6dd-…` |

---

## 6. Automated gates

All run from the repository root in this worktree.

| Command | Result |
| --- | --- |
| `git diff --check` | **Pass** (exit 0) |
| `npm run lint --prefix web` | **Pass** (eslint, exit 0, no output) |
| `cd web && npm run typecheck` | **Pass** (`tsc -b --pretty false`, exit 0) |
| `cd web && npm test -- --run` | **Pass** — 8 files, **37 tests**, 0 failures (2.08s) |
| `cd web && npm run build` | **Pass** — `tsc -b && vite build`, 42 modules, `index-C65n958x.css` 35.14 kB, `index-oROjeBhJ.js` 285.31 kB |
| Impeccable file-target detector | **Pass** — `[]` |

Detector command run exactly as specified by this task, **without** the
`--no-advisory` suppression used by the remediation, over all ten V2
implementation files:

```bash
node /Users/sungjin/.agents/skills/impeccable/scripts/detect.mjs --json \
  web/src/App.tsx web/src/overview/OverviewView.tsx web/src/traces/TracesView.tsx \
  web/src/styles.css web/src/components.tsx web/src/annotations/QueuesView.tsx \
  web/src/scores/ScoresView.tsx web/src/evaluation/EvaluationView.tsx \
  web/src/settings/LocalDataView.tsx web/src/graph/RuntimeGraphView.tsx
# -> []
```

---

## 7. Verification limits

These are recorded as limits, **not** as passes.

1. **Screenshots.** Two of this session's own captures succeeded
   (`1297d832-4102-43dc-8d58-7bf00a791e8d` Overview desktop,
   `160903a7-a5d1-4ab3-b2f9-d415a16f0f8b` Traces desktop). Subsequent
   `Page.captureScreenshot` calls failed with
   `"Screenshot timed out — the browser tab may not be visible or the window may
   not have focus"` (`ce5c63f9-…`, `2be7edec-…`), at both 390 and 1280, on both
   tabs. All fidelity claims in this report are therefore anchored on measured
   DOM/CSSOM values rather than pixels — which is stronger evidence for the
   specific geometry, colour and state claims made here, but does not by itself
   satisfy the checklist's "screenshot evidence for all six screens at desktop and
   mobile". The prior sessions' screenshot IDs listed in `FIDELITY_AUDIT.md` remain
   available as historical evidence for that requirement.
2. **Console capture window.** The console wrapper is installed immediately after
   each page load, so the first milliseconds of React's initial mount are not
   wrapped. This was mitigated by a full six-route SPA loop (every view mounts
   under instrumentation) at both viewports. Network coverage has no such gap —
   `PerformanceResourceTiming` covers the entire timeline including initial load.
3. **Tool Calls ≥3-tool branch.** The audit fixture contains no `tool`-typed
   observations, so the "`__others__` hidden at ≥3 distinct tools" row of the
   P1-R01 trigger table was derived from the server key ordering
   (`repository.py:1164-1170`) and the client `.slice(0, 3)`
   (`OverviewView.tsx:85-87`) rather than rendered. The 0-tool row — the one that
   blocks acceptance — was rendered and measured live.
4. **Puppeteer-backed URL form of the Impeccable detector** is unavailable in this
   workspace (no `puppeteer` installed). The static file-target form specified by
   this task ran clean.
5. **Reference integrity** is a session SHA-256 comparison; the V2 files are
   untracked, so there is no committed-Git baseline to diff against.

---

## 8. Checklist disposition

| Checklist section | Disposition | Basis |
| --- | --- | --- |
| Visual authority, rebuild boundary, no legacy reuse | **Pass** (untracked-reference caveat) | checksums identical before/after; no `web/src` change by this audit; no P0 |
| Global shell, navigation, responsive behaviour | **Pass** | six routes in source order; mobile wordmark now matches all six references; no horizontal overflow at 1280 or 390 |
| Reduced motion | **Pass** | genuinely emulated; `auto` branch exercised and recorded |
| Overview | **Blocked** | navigator/recent-trace requirements all pass; Tool Calls chart semantics fail in **P1-R01** |
| Traces | **Pass** | filter composition + desktop/mobile geometry match to sub-pixel; two-Escape layering and focus restore confirmed |
| Annotation Queues | **Pass** for the re-audited scope | mobile shell now retains the wordmark; renders clean at both viewports |
| Scores | **Pass** for the re-audited scope | as above; P2-R01 control-token delta documented |
| Evaluation | **Pass** for the re-audited scope | as above |
| Setting | **Pass** for the re-audited scope | as above |
| Required automated evidence | **Pass** | §6 — all six gates green, detector `[]` without advisory suppression |
| Screenshot evidence for all six screens | **Not satisfied by this session** | see §7.1 |

Surfaces marked "Pass for the re-audited scope" were verified against the specific
items this re-audit was chartered to test (mobile shell, console, network,
overflow, automated gates). This re-audit did not re-run a full structural sweep of
those four management screens; `FIDELITY_AUDIT.md` records that sweep and found no
P0 or P1 on them other than the now-resolved shared wordmark rule.

---

## 9. Final acceptance decision

**NOT ACCEPTED.**

Acceptance requires zero open P0 **and** zero open P1 findings.

- **P0 open: 0.**
- **P1 open: 1** — `P1-R01`, Overview Tool Calls chart renders the server's
  internal `__others__` aggregation key as a user-facing zero-value series, in
  violation of `specs/web-functional.md:60` and Authority item 4 of
  `IMPLEMENTATION_CHECKLIST.md`.
- **P2 open: 1** — `P2-R01`, documented, non-blocking.

The four originally-blocking findings `P1-01`, `P1-02`, `P1-03` and `P1-04` are
independently confirmed **resolved**, and the new Overview Recent Traces
requirement is confirmed **met in full**, including pointer, Enter and Space
activation, URL state, real graph/payload rendering, and Escape-with-focus-restore.
The remediation task's work is sound; acceptance is withheld solely on the
independently reproduced `P1-R01`.

### Remaining blockers

1. Stop rendering `__others__` as a visible series. Filter the sentinel out of the
   Tool Calls series in `web/src/overview/OverviewView.tsx:85-87,176-180`, and when
   the window's tool-call total is zero, show the explicit "no tool calls in this
   period" state that `specs/web-functional.md:60` requires instead of a flat
   zero line. Validate the fix against a window with **0, 1 and 2** distinct tool
   names — a three-tool fixture hides the defect.
2. Optional, non-blocking: restore the per-reference `.btn` and `.brand` token
   values for Traces, Scores and Queues (P2-R01).
3. Re-capture desktop and 390px screenshots for all six screens in a session where
   the Orca browser window is visible, to close the checklist's screenshot-evidence
   requirement (§7.1).

No product code, no `design-explorations/v2/*-light.html` reference, and no
existing report was modified by this re-audit. The only file written is this one.
