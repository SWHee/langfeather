import {describe, expect, it} from "vitest";
import {APP_TITLE} from "./constants";

describe("application foundation", () => {
  it("uses the locked product name", () => {
    expect(APP_TITLE).toBe("LangFeather");
  });
});

