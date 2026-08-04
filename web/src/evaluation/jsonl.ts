import type { DatasetExample, JsonValue } from "../api/types";

export interface JsonlExample {
  input: JsonValue;
  expected_output: JsonValue | null;
  metadata: { [key: string]: JsonValue };
}

export interface JsonlEntry {
  lineNumber: number;
  example: JsonlExample;
}

export interface JsonlParseResult {
  entries: JsonlEntry[];
  failedLines: number[];
}

/** Export writes only the portable fields; internal IDs stay on the server. */
export function examplesToJsonl(examples: readonly DatasetExample[]): string {
  if (examples.length === 0) {
    return "";
  }
  return `${examples
    .map((example) =>
      JSON.stringify({
        input: example.input,
        expected_output: example.expected_output,
        metadata: example.metadata,
      }),
    )
    .join("\n")}\n`;
}

function parseJsonlExample(value: unknown): JsonlExample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("example must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "input")) {
    throw new Error("input is required");
  }
  const rawMetadata = record.metadata ?? {};
  if (
    typeof rawMetadata !== "object" ||
    rawMetadata === null ||
    Array.isArray(rawMetadata)
  ) {
    throw new Error("metadata must be a JSON object");
  }
  return {
    input: record.input as JsonValue,
    expected_output: Object.prototype.hasOwnProperty.call(
      record,
      "expected_output",
    )
      ? (record.expected_output as JsonValue | null)
      : null,
    metadata: rawMetadata as { [key: string]: JsonValue },
  };
}

/** Each line parses on its own so one bad line never hides the good ones. */
export function parseJsonl(contents: string): JsonlParseResult {
  const entries: JsonlEntry[] = [];
  const failedLines: number[] = [];
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    if (rawLine.trim() === "") continue;
    const lineNumber = index + 1;
    try {
      entries.push({
        lineNumber,
        example: parseJsonlExample(JSON.parse(rawLine) as unknown),
      });
    } catch {
      failedLines.push(lineNumber);
    }
  }
  return { entries, failedLines };
}

export function jsonlFileName(dataset: {
  name: string;
  dataset_id: string;
}): string {
  const safeName = dataset.name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeName || dataset.dataset_id}.jsonl`;
}

export function readTextFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("file read failed")),
    );
    reader.readAsText(file);
  });
}

export function downloadJsonl(fileName: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/x-ndjson" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
