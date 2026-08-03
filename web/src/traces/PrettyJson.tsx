import {useEffect, useState} from "react";

import type {JsonValue} from "../api/types";
import {copyText} from "../components";

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function jsonPreview(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    return `Object(${Object.keys(value).length})`;
  }
  return formatJson(value);
}

function JsonTree({value, depth = 0}: {value: JsonValue; depth?: number}) {
  if (Array.isArray(value)) {
    return (
      <details className="json-tree-branch" open={depth < 1}>
        <summary>{jsonPreview(value)}</summary>
        <ol className="json-tree-list">
          {value.map((item, index) => (
            <li key={index}>
              <span className="json-tree-key">{index}: </span>
              <JsonTree value={item} depth={depth + 1} />
            </li>
          ))}
        </ol>
      </details>
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      <details className="json-tree-branch" open={depth < 1}>
        <summary>{jsonPreview(value)}</summary>
        <ul className="json-tree-list">
          {Object.entries(value).map(([key, item]) => (
            <li key={key}>
              <span className="json-tree-key">{JSON.stringify(key)}: </span>
              <JsonTree value={item} depth={depth + 1} />
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return <code className="json-tree-value">{formatJson(value)}</code>;
}

export function JsonSection({title, value}: {title: string; value: unknown}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeoutId = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  if (value === undefined) {
    return null;
  }

  return (
    <details className="json-section" open>
      <summary>{title}</summary>
      <button
        className="json-copy-button"
        type="button"
        aria-live="polite"
        onClick={() => {
          void copyText(formatJson(value)).then(() => setCopied(true));
        }}
      >
        {copied ? "복사됨" : "복사"}
      </button>
      <div className="json-tree" aria-label={`${title} JSON`}>
        <JsonTree value={value as JsonValue} />
      </div>
    </details>
  );
}
