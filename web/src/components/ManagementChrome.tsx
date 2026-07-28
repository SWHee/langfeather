import { type ReactNode, useEffect, useRef, useState } from "react";

import { useDismissiblePopover } from "./useDismissiblePopover";

export type OverflowAction = {
  label: string;
  icon: "archive" | "edit" | "trash";
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function ActionIcon({ icon }: { icon: OverflowAction["icon"] }) {
  if (icon === "edit") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" />
        <path d="m14.8 6.8 2.4 2.4" />
      </svg>
    );
  }
  if (icon === "archive") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h16v13H4zM3 4h18v3H3z" />
        <path d="M9 11h6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

export function OverflowMenu({
  label,
  actions,
}: {
  label: string;
  actions: OverflowAction[];
}) {
  const [open, setOpen] = useState(false);
  const { rootRef, triggerRef } = useDismissiblePopover(open, () =>
    setOpen(false),
  );

  return (
    <div className="overflow-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="icon-button overflow-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="overflow-menu-content" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              className={action.danger ? "danger" : undefined}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              <ActionIcon icon={action.icon} />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ManagementDialog({
  title,
  titleId,
  className = "",
  onClose,
  children,
}: {
  title: string;
  titleId: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    const primaryField = dialog?.querySelector<HTMLElement>(
      ".management-form input:not([disabled]), .management-form select:not([disabled]), .management-form textarea:not([disabled])",
    );
    const focusable = dialog?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
    );
    (primaryField ?? focusable ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="management-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`management-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label={`${title} 닫기`}
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
