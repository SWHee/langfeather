---
name: LangFeather
description: Restrained local workspace for inspecting LLM runtime traces
colors:
  ink: "#17191f"
  canvas: "#f3f4f6"
  surface: "#ffffff"
  panel: "#f8f9fa"
  line: "#e2e4e9"
  muted: "#6b7280"
  primary: "#2563eb"
  primary-deep: "#1d4ed8"
  primary-wash: "#eff6ff"
  success: "#22a06b"
typography:
  body:
    fontFamily: "Inter, Pretendard, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontWeight: 400
  label:
    fontFamily: "Inter, Pretendard, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 650
  mono:
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace"
rounded:
  control: "8px"
  mark: "9px"
  pill: "999px"
spacing:
  tight: "6px"
  compact: "8px"
  base: "16px"
  section: "20px"
  header: "22px"
components:
  navigation-active:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-deep}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
---

# Design System: LangFeather

## Overview

**Creative North Star: "The Quiet Debugging Bench"**

LangFeather is a restrained, high-signal workspace for examining runtime evidence.
It uses cool paper-like surfaces, a precise blue for active intent, and dense but
breathable information layouts. The product should feel like a carefully kept local
engineering tool, not an executive dashboard.

**Key Characteristics:**

- Evidence-first hierarchy: trace data and selected output own the space.
- Blue appears for navigation, focus, and deliberate actions rather than decoration.
- Border-and-tone separation does more work than shadow.
- Compact labels and monospace identifiers support scanning without visual noise.

## Colors

The palette is cool, neutral, and deliberately sparse; the primary blue marks active
work and never becomes a competing background field.

### Primary

- **Working Blue:** `primary` is reserved for selected navigation, focus, primary
  actions, and links to the currently investigated evidence.
- **Active Blue:** `primary-deep` is used for selected text and high-contrast action
  emphasis.
- **Working Wash:** `primary-wash` provides the quiet selected state behind primary
  text.

### Neutral

- **Graphite Ink:** `ink` carries headings and high-priority content.
- **Cool Canvas:** `canvas` is the application background; `panel` distinguishes
  persistent navigation and work regions.
- **Paper Surface:** `surface` is reserved for controls and readable content.
- **Fine Rule:** `line` separates information regions without card-heavy chrome.
- **Muted Readout:** `muted` carries secondary timestamps and context.

**The One Signal Rule.** Blue means current intent or actionable state. Do not use it
as a decorative accent scattered across dense diagnostic content.

## Typography

**Body Font:** Inter/Pretendard system stack.
**Label/Mono Font:** SFMono-Regular/Consolas monospace stack for IDs and JSON-adjacent
diagnostic values.

**Character:** Compact, calm, and readable at tool density. Weight and contrast create
hierarchy before size changes do.

### Hierarchy

- **Title:** Strong sans-serif headings identify the current workspace or selected
  trace.
- **Body:** System sans-serif carries controls, explanatory copy, and table values.
- **Label:** The `label` role is compact and semibold for filters, statuses, and
  navigation.
- **Mono:** Identifiers, payload fragments, and code-like values use the `mono` role.

## Layout

The desktop workspace uses a persistent header and split-pane inspection layout: a
narrow navigation/list context beside a broad detail workspace. Dense lists retain
comfortable row separation rather than card grids. On small screens, the active task
stays primary and navigation condenses before payload inspection is compromised.

## Elevation & Depth

Depth is mostly tonal. Fine borders distinguish canvas, panel, and paper surfaces;
the sticky header uses a restrained translucent backdrop rather than heavy elevation.

**The Evidence Plane Rule.** A selected trace or experiment may be visually active,
but it should never look detached from the workspace through oversized shadows.

## Shapes

Controls use gently curved corners (`control`) with compact internal padding. Pills
are reserved for counts, statuses, and local-state badges. Containers stay rectangular
enough to support dense tables and inspectors.

## Components

### Buttons

- **Shape:** Compact controls with `control` rounding.
- **Primary:** Working blue is used for explicit commits such as run, create, or save.
- **Hover / Focus:** Hover adds a subtle tonal shift; keyboard focus uses a clear blue
  outline with offset.

### Inputs / Fields

- **Style:** White paper surface, fine neutral border, compact height.
- **Focus:** Blue outline is always visible to keyboard users.

### Navigation

- **Style:** Text-forward tabs in the header; selected state uses Working Wash and
  Active Blue rather than an underline-heavy dashboard treatment.
- **Mobile:** Keep the current task identifiable when labels condense.

### Chips

- **Style:** Pill-shaped status and count readouts with fine borders and quiet text.

## Do's and Don'ts

### Do:

- **Do** preserve a clear selected-state hierarchy across trace, queue, and evaluation
  workflows.
- **Do** put expected/actual evidence ahead of aggregate metrics in evaluation detail.
- **Do** use empty states to explain the next concrete local action.

### Don't:

- **Don't** turn the Evaluation surface into a metric-dashboard card grid.
- **Don't** use blue for non-interactive decoration.
- **Don't** hide failure and incomplete-run states behind optimistic aggregate scores.
