import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {
  isCompletedEnvelope,
  isFeedback,
  type CompletedEnvelope,
} from "./types";

function loadFixture(name: string): unknown {
  const fixturePath = resolve(
    process.cwd(),
    "..",
    "tests",
    "fixtures",
    "envelopes",
    name,
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

describe("schema v1 contract fixtures", () => {
  it.each(["completed.json", "failed.json", "parallel.json", "loop.json"])(
    "accepts %s",
    (fixtureName) => {
      const value = loadFixture(fixtureName);

      expect(isCompletedEnvelope(value)).toBe(true);
      const envelope = value as CompletedEnvelope;
      expect(envelope.schema_version).toBe(1);
    },
  );

  it("accepts feedback before its trace exists", () => {
    expect(isFeedback(loadFixture("feedback-before-trace.json"))).toBe(true);
  });

  it("rejects an unsupported schema version", () => {
    const value = loadFixture("completed.json") as Record<string, unknown>;
    value.schema_version = 2;

    expect(isCompletedEnvelope(value)).toBe(false);
  });
});

