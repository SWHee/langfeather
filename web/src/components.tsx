/* eslint-disable react-refresh/only-export-components -- shared presentation utilities are intentionally co-located with primitives. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { JsonValue, TraceStatus } from "./api/types";
import { previewOf } from "./preview";
import { useT, type Translate } from "./i18n/context";
import { translate } from "./i18n/i18n";

/** t를 넘기지 않은 호출부의 기본값. */
const koT: Translate = (korean, params) => translate("ko", korean, params);

export function formatDuration(durationUs: number | null | undefined): string {
  if (durationUs === null || durationUs === undefined) return "—";
  if (durationUs < 1_000) return `${durationUs}µs`;
  if (durationUs < 1_000_000) return `${Math.round(durationUs / 1_000)}ms`;
  return `${(durationUs / 1_000_000).toFixed(durationUs < 10_000_000 ? 2 : 1)}s`;
}

export function formatDateTime(
  value: string | null | undefined,
  locale = "ko-KR",
): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatClockTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  const hours24 = parsed.getHours();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${month}/${day} ${hours12}:${minutes} ${period}`;
}

/** 호출부가 t를 넘긴다. 넘기지 않으면 한국어로 나온다. */
export function relativeTime(value: string, t: Translate = koT): string {
  const elapsed = Date.now() - new Date(value).valueOf();
  if (!Number.isFinite(elapsed)) return value;
  const seconds = Math.max(0, Math.floor(elapsed / 1_000));
  if (seconds < 60) return t("{n}초 전", {n: seconds});
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("{n}분 전", {n: minutes});
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{n}시간 전", {n: hours});
  return t("{n}일 전", {n: Math.floor(hours / 24)});
}

export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offsetMs).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function jsonText(value: JsonValue | undefined | null): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function jsonPreview(value: JsonValue | undefined | null): string {
  const text = jsonText(value);
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

/**
 * input/output처럼 값만 읽으면 되는 payload의 목록용 요약. metadata에는 쓰지
 * 않는다 — 거기서는 key 자체가 정보다. 읽어낼 값이 없으면 JSON으로 되돌린다.
 */
export function valuePreview(value: JsonValue | undefined | null): string {
  // 없는 값은 "null"이 아니라 다른 빈 표기와 같은 —로 읽힌다.
  if (value === null || value === undefined) return "—";
  const text = previewOf(value);
  if (text === "") return jsonPreview(value);
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

export function deferState(callback: () => void): void {
  void Promise.resolve().then(callback);
}

export function statusLabel(status: TraceStatus, t: Translate = koT): string {
  return status === "completed"
    ? t("성공")
    : status === "failed"
      ? t("실패")
      : t("취소");
}

/* icon은 glyph 대신 SVG로 그린다. glyph는 font fallback에 따라 굵기와 정렬이
   기기마다 달라진다. 크기와 색은 부모의 font-size, color를 따른다. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="lf-svg-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconClose() {
  return (
    <Icon>
      <path d="M4 4 12 12M12 4 4 12" />
    </Icon>
  );
}

export function IconArrowLeft() {
  return (
    <Icon>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Icon>
  );
}

export function IconArrowRight() {
  return (
    <Icon>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Icon>
  );
}

/** 펼치기. 펼친 상태는 CSS가 180° 돌려서 나타낸다 — glyph를 바꾸지 않는다. */
export function IconChevronDown() {
  return (
    <Icon>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Icon>
  );
}

export function IconMore() {
  return (
    <Icon>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconSort({ direction }: { direction?: SortDirection }) {
  if (direction === "asc") {
    return (
      <Icon>
        <path d="M8 12.5V4M4.5 7.5 8 4l3.5 3.5" />
      </Icon>
    );
  }
  if (direction === "desc") {
    return (
      <Icon>
        <path d="M8 3.5V12M4.5 8.5 8 12l3.5-3.5" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M5 6.5 5 12M3.2 10.2 5 12l1.8-1.8M11 9.5 11 4M9.2 5.8 11 4l1.8 1.8" />
    </Icon>
  );
}

export function StatusDot({ status }: { status: TraceStatus }) {
  const t = useT();
  return (
    <span
      className={`lf-status ${status === "failed" ? "is-error" : status === "cancelled" ? "is-cancelled" : ""}`}
    >
      {statusLabel(status, t)}
    </span>
  );
}

export function JsonCode({
  value,
  className = "",
}: {
  value: JsonValue | undefined | null;
  className?: string;
}) {
  return <pre className={`lf-code ${className}`.trim()}>{jsonText(value)}</pre>;
}

export function LoadingBlock({ label }: { label?: string }) {
  const t = useT();
  return (
    <p className="lf-state" role="status">
      {label ?? t("불러오는 중…")}
    </p>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div className="lf-state is-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button className="lf-btn" type="button" onClick={onRetry}>
          {t("다시 시도")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ children }: { children: ReactNode }) {
  return <p className="lf-state is-empty">{children}</p>;
}

export function useEscape(open: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onEscape]);
}

export function Modal({
  open,
  title,
  children,
  onClose,
  className = "",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  const titleId = useId();
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div
      className="lf-dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`lf-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="lf-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            className="lf-icon-btn"
            type="button"
            onClick={onClose}
            aria-label={t("닫기")}
          >
            <IconClose />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export const LIST_PAGE_SIZE = 20;

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number = LIST_PAGE_SIZE,
): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  return (
    <div className="pagination">
      <button
        className="lf-icon-btn"
        type="button"
        aria-label={t("이전 페이지")}
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        <IconArrowLeft />
      </button>
      <span className="pagination-position">
        {page} / {totalPages}
      </span>
      <button
        className="lf-icon-btn"
        type="button"
        aria-label={t("다음 페이지")}
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
      >
        <IconArrowRight />
      </button>
    </div>
  );
}

export function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText)
    return navigator.clipboard.writeText(value);
  return Promise.resolve();
}

const MIN_COLUMN_WIDTH = 80;

export interface ReorderableColumnDef {
  id: string;
  label: string;
  width: number;
  /** 자릿수를 세로로 비교해야 하는 숫자 열은 "end"로 우측 정렬한다. */
  align?: "end";
}

export type SortDirection = "asc" | "desc";

interface HeaderDragState {
  id: string;
  startX: number;
  /** Other column ids in their (drag-stable) relative order, excluding the dragged one. */
  otherIds: string[];
  /** Left offset (px) of each entry in otherIds, cumulative by width. */
  otherLeftOffsets: number[];
  /** Left offset (px) of the dragged column in the order at drag start. */
  originalLeft: number;
  widths: Record<string, number>;
}

function leftOffsetOf(id: string, order: string[], widths: Record<string, number>) {
  let left = 0;
  for (const columnId of order) {
    if (columnId === id) break;
    left += widths[columnId] ?? MIN_COLUMN_WIDTH;
  }
  return left;
}

/**
 * Column order, width, and sort state for a data table. Reordering is pointer-driven and
 * horizontal-only (Notion-style): the dragged header only ever translates on the x-axis, and
 * other headers live-shift to make room as the drag crosses their midpoint.
 */
export function useReorderableColumns(defs: ReorderableColumnDef[]) {
  const [order, setOrder] = useState<string[]>(() => defs.map((d) => d.id));
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(defs.map((d) => [d.id, d.width])),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [sort, setSort] = useState<{ id: string; direction: SortDirection } | null>(
    null,
  );
  const dragState = useRef<HeaderDragState | null>(null);
  const resizeState = useRef<{
    id: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onHeaderPointerDown =
    (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
      const otherIds = order.filter((columnId) => columnId !== id);
      const otherLeftOffsets: number[] = [];
      let left = 0;
      for (const columnId of otherIds) {
        otherLeftOffsets.push(left);
        left += widths[columnId] ?? MIN_COLUMN_WIDTH;
      }
      dragState.current = {
        id,
        startX: event.clientX,
        otherIds,
        otherLeftOffsets,
        originalLeft: leftOffsetOf(id, order, widths),
        widths,
      };
      setDragId(id);
      setDragOffset(0);
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = dragState.current;
    if (!state) return;
    const pointerDeltaX = event.clientX - state.startX;
    const tentativeCenter =
      state.originalLeft + pointerDeltaX + (state.widths[state.id] ?? MIN_COLUMN_WIDTH) / 2;
    let targetIndex = 0;
    for (; targetIndex < state.otherIds.length; targetIndex++) {
      const otherId = state.otherIds[targetIndex];
      if (otherId === undefined) break;
      const center =
        (state.otherLeftOffsets[targetIndex] ?? 0) +
        (state.widths[otherId] ?? MIN_COLUMN_WIDTH) / 2;
      if (tentativeCenter < center) break;
    }
    const newOrder = [
      ...state.otherIds.slice(0, targetIndex),
      state.id,
      ...state.otherIds.slice(targetIndex),
    ];
    setOrder((current) =>
      current.length === newOrder.length &&
      current.every((value, index) => value === newOrder[index])
        ? current
        : newOrder,
    );
    const committedShift = leftOffsetOf(state.id, newOrder, state.widths) - state.originalLeft;
    setDragOffset(pointerDeltaX - committedShift);
  };

  const onHeaderPointerUp = () => {
    dragState.current = null;
    setDragId(null);
    setDragOffset(0);
  };

  const onResizeStart =
    (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeState.current = {
        id,
        startX: event.clientX,
        startWidth: widths[id] ?? MIN_COLUMN_WIDTH,
      };
      const onMove = (moveEvent: PointerEvent) => {
        const state = resizeState.current;
        if (!state) return;
        const delta = moveEvent.clientX - state.startX;
        setWidths((current) => ({
          ...current,
          [state.id]: Math.max(MIN_COLUMN_WIDTH, state.startWidth + delta),
        }));
      };
      const onUp = () => {
        resizeState.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

  const onSortToggle = (id: string) => {
    setSort((current) => {
      if (!current || current.id !== id) return { id, direction: "asc" };
      if (current.direction === "asc") return { id, direction: "desc" };
      return null;
    });
  };

  return {
    order,
    widths,
    dragId,
    dragOffset,
    sort,
    onHeaderPointerDown,
    onHeaderPointerMove,
    onHeaderPointerUp,
    onResizeStart,
    onSortToggle,
  };
}

export type ReorderableColumns = ReturnType<typeof useReorderableColumns>;

/** `<colgroup>` matching a reorderable-columns table: a fixed select column plus one `<col>` per data column. */
export function SelectColGroup({ columns }: { columns: ReorderableColumns }) {
  return (
    <colgroup>
      <col className="select-col" />
      {columns.order.map((id) => (
        <col key={id} style={{ width: columns.widths[id] }} />
      ))}
    </colgroup>
  );
}

/** A `<th>` that supports drag-to-reorder, drag-to-resize, and click-to-sort, driven by `useReorderableColumns`. */
export function ColumnHeaderCell({
  id,
  label,
  align,
  columns,
}: {
  id: string;
  label: string;
  align?: "end";
  columns: ReorderableColumns;
}) {
  const t = useT();
  const isDragging = columns.dragId === id;
  const sortActive = columns.sort?.id === id;
  return (
    <th
      className={`col-draggable${isDragging ? " is-dragging" : ""}${align === "end" ? " is-end" : ""}`}
      style={
        isDragging
          ? { transform: `translateX(${columns.dragOffset}px)` }
          : undefined
      }
      onPointerDown={columns.onHeaderPointerDown(id)}
      onPointerMove={columns.onHeaderPointerMove}
      onPointerUp={columns.onHeaderPointerUp}
    >
      <span className="col-head-row">
        <span className="col-head-label">{label}</span>
        <button
          className={`col-sort${sortActive ? " is-active" : ""}`}
          type="button"
          aria-label={t("{label} 기준 정렬", {label})}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => columns.onSortToggle(id)}
        >
          <IconSort direction={sortActive ? columns.sort?.direction : undefined} />
        </button>
      </span>
      <span
        className="col-resize-handle"
        onPointerDown={columns.onResizeStart(id)}
      />
    </th>
  );
}

/** Sorts `rows` by the active column in `sort`, using the matching accessor from `accessors`. Returns `rows` unchanged if nothing is sorted. */
export function sortRows<T>(
  rows: T[],
  sort: { id: string; direction: SortDirection } | null,
  accessors: Record<string, (row: T) => string | number>,
): T[] {
  if (!sort) return rows;
  const accessor = accessors[sort.id];
  if (!accessor) return rows;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = accessor(left);
    const rightValue = accessor(right);
    if (leftValue < rightValue) return -direction;
    if (leftValue > rightValue) return direction;
    return 0;
  });
}
