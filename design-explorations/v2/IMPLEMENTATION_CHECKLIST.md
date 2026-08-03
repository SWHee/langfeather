# V2 frontend implementation and fidelity gate

## Authority

1. `design-explorations/v2/*-light.html` is the first and final visual authority.
2. If `DESIGN.md`, `.agents/design.md`, `specs/web-*.md`, the current React UI, or
   deleted Git history conflicts with a V2 HTML file, the V2 HTML file wins.
3. The current React presentation is an anti-reference. Do not copy its JSX,
   CSS, component hierarchy, responsive rules, visual tokens, or chart styling.
4. Non-visual API and data contracts may be reused only to connect the new UI
   to the real server. They must not change the visible composition of a V2
   screen.
5. Real data may replace demo values, but section order, density, geometry,
   labels, control placement, and empty/loading/error footprints must remain in
   the visual grammar of the corresponding V2 screen.

## Clean rebuild boundary

- Remove and rebuild the current presentation under `web/src`: app shell,
  screen components, presentation helpers, screen interaction tests, graph
  presentation, chart presentation, and `styles.css`.
- Keep the React/Vite package bootstrap and preserve or re-create only the
  non-visual contracts required by the real server, especially API request and
  response types. Existing presentation code must not be used as a baseline.
- Preserve all six V2 HTML files unchanged. Do not modify the references to
  make the implementation appear closer.
- Replace old presentation tests with tests for the new V2-derived UI. Preserve
  pure API/data tests when they remain valid.
- Update `DESIGN.md` so it states that the six V2 HTML files are the sole visual
  source of truth; the React implementation is a derived artifact, never a
  co-equal source.

## Reference map

| Product surface | Sole visual reference |
| --- | --- |
| Overview | `claude-modular-observatory-light.html` |
| Traces | `claude-traces-workspace-light.html` |
| Annotation Queues | `claude-annotation-queues-light.html` |
| Scores | `claude-scores-light.html` |
| Evaluation | `claude-evaluation-light.html` |
| Setting | `claude-settings-light.html` |

## Global fidelity checks

- [ ] Top navigation contains exactly `Overview / Traces / Annotation Queues /
      Scores / Evaluation / Setting` in that order.
- [ ] The active navigation treatment, LangFeather mark, environment badge,
      typography, shell height, padding, and mobile behavior match each V2
      reference rather than a generic shared approximation.
- [ ] Reference-specific palettes are retained. In particular, do not collapse
      the Overview/Traces navy `#163b70` system and the management-screen navy
      `#264a7d` system into one arbitrary token.
- [ ] Page, surface, line, strong-line, ink, muted, quiet, success, warning,
      danger, and comparison colors match the reference HTML values.
- [ ] Type sizes, weights, line heights, mono usage, border widths, radii,
      shadows, row heights, control heights, and spacing are source-derived.
- [ ] Tables remain the primary dense desktop structure. No card-wall
      reinterpretation is introduced where the source uses a table or list.
- [ ] Drawers, scrims, dialogs, popovers, and focus return match the source
      placement and visual proportions.
- [ ] Synthetic values are visibly labelled `예시` or `데모` where a user could
      mistake them for real server data.
- [ ] No decorative icon, gradient, glass treatment, animation, or copy is
      introduced unless present in the corresponding V2 file.
- [ ] `prefers-reduced-motion` behavior from every source is preserved.
- [ ] Long IDs, payload JSON, empty lists, loading, errors, and pending actions
      fit inside the source composition without page-level horizontal overflow.

## Overview — modular observatory

- [ ] Header, `Traffic observatory` subtitle, layout-edit control, trace action,
      filter strip, quick periods, chart navigator, traffic board, and recent
      Trace table appear in the same order and proportions.
- [ ] The board contains the five source charts: Trace Count, Trace Latency,
      Trace Error Rate, LLM Calls, and Tool Calls. Do not add another default
      chart merely because the API exposes more data.
- [ ] Initial spans are `12 / 8 / 4 / 6 / 6`; the board uses 12 columns and a
      16px gutter.
- [ ] Trace Count is Success green + Error red only. Latency is p50 navy, p95
      orange, p99 violet. Tool colors are retriever green, search orange, http
      violet.
- [ ] Pointer crosshair, exact time/value tooltip, focus, ArrowLeft/ArrowRight,
      Home/End navigation, legend, grid, and axis density match the source.
- [ ] Layout editing exposes drag grips, plus/minus resize controls, and the
      lower-right pointer resize affordance. Resize math accounts for all 11
      gutters.
- [ ] At 820px only source spans 4–8 become full width. At 520px the wordmark
      text and card subtitles hide, chart height becomes 184px, and resize
      controls become 24px.
- [ ] Recent Trace keeps the source column order, minimum table width, payload
      typography, relative time, and success/error/cancelled dot semantics.
- [ ] A Recent Trace row opens the selected trace detail drawer/card by pointer
      or Enter/Space, reflects the selected trace in URL state, and returns
      focus to the originating row when Escape closes the detail.

## Traces — investigation workspace

- [ ] Page header, result count/bulk actions, the source four-field filter panel
      (search, status, relative period, tag), dense trace table, selectable rows,
      and source column order match the source.
- [ ] Trace detail opens as a right scrim drawer with the source width, resize
      edge, header layout, session navigation, actions menu, and close control.
- [ ] Drawer detail retains the two-column graph + Input/Output arrangement,
      graph toolbar, evidence nodes/edges, payload cards, and annotation section.
- [ ] Add-to-queue, add-to-dataset, delete confirmation, bulk delete, score
      picker, boolean/number/categorical annotation controls, save status, and
      focus/Escape flows use the source surfaces and placement.
- [ ] Desktop table density and 820px/520px drawer/mobile rules match the source.
      The mobile implementation must not replace the V2 composition with a new
      navigation or card system.

## Annotation Queues

- [ ] List view matches eyebrow, title, `+ New Queue`, search/count toolbar,
      row/card composition, per-row statistics, updated time, and menu placement.
- [ ] Detail view matches back navigation, title/description/scores, destructive
      actions, selectable trace table, and source column order.
- [ ] Review opens the source 760px right drawer with resizable edge, graph,
      Input/Output panels, score controls, memo, footer status, and completion
      action.
- [ ] List/detail/drawer/dialog states retain the 850px mobile rules and source
      focus, Escape, scrim, and reduced-motion behavior.

## Scores

- [ ] Page title, `+ New Score`, search/count toolbar, dense table, state badge,
      row action menu, and column order match the reference.
- [ ] New/edit score uses the reference modal shell and form rhythm.
- [ ] Boolean, number, and categorical configurations retain the source-specific
      controls, option rows, add/remove actions, labels, and modal sizing.
- [ ] Search, row menu, close/Escape, create/edit/archive/delete and the 700px
      responsive behavior do not introduce a different management UI.

## Evaluation

- [ ] Dataset list view matches title/subtitle, right-aligned search, dataset
      row/card grid, metrics, update metadata, and selected/hover treatment.
- [ ] Detail view matches back/title/revision header and the source `Examples /
      Experiments` tab order.
- [ ] Examples retain the source three-column dense table.
- [ ] Experiments retain the two-card comparison area, baseline explanation,
      selection summary, note, experiment table, status/revision/cases/duration/
      evaluator columns, and chart/legend styling.
- [ ] Same-revision selection behavior, maximum comparison count, keyboard tab
      behavior, 850px stacking, and reduced motion fit the source layout.

## Setting

- [ ] Eyebrow, title, subtitle, Backup section, SQLite backup card, Reset
      section, reset warning card, `RESET` input, status text, and action
      placement match the source.
- [ ] The destructive confirmation uses the source modal, copy, button order,
      focus/Escape behavior, and 640px responsive rules.

## Required implementation evidence

- [ ] `npm run lint --prefix web`
- [ ] `npm run typecheck --prefix web`
- [ ] `npm test --prefix web -- --run`
- [ ] `npm run build --prefix web`
- [ ] `git diff --check`
- [ ] Orca browser screenshots for every reference and implementation at one
      desktop viewport and approximately 390px mobile.
- [ ] Per-screen side-by-side review covering structure, geometry, typography,
      color, density, responsive behavior, and primary interactions.
- [ ] Orca browser smoke for navigation, Overview chart interaction/layout edit,
      trace filter/detail/graph/payload/actions, queue review, score modal,
      Evaluation tabs/comparison, and Setting reset confirmation.
- [ ] Browser console and network errors recorded; no success claim based only
      on Vite boot, curl, tests, or source inspection.
- [ ] Run the Impeccable detector once after the final UI changes:
      `node /Users/sungjin/.agents/skills/impeccable/scripts/detect.mjs --json <changed targets>`.

## Review severity and acceptance

- **P0 — reject:** wrong page structure, missing surface, wrong navigation,
  different information architecture, missing drawer/dialog/table, invented
  default section, or existing UI reused as a visual baseline.
- **P1 — fix before acceptance:** materially different geometry, density,
  typography, palette, chart semantics, responsive rule, interaction affordance,
  focus behavior, or destructive flow.
- **P2 — document and fix when visible:** small spacing, text wrapping, icon
  alignment, or sub-pixel rendering differences that do not alter hierarchy.

Acceptance requires zero open P0/P1 findings, screenshot evidence for all six
screens at desktop and mobile, passing automated gates, and one independent
reviewer report. “Similar”, “inspired by”, or source-level inspection alone is
not sufficient evidence.
