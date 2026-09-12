import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@normwerk/einvoice-model scaffold", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@normwerk/einvoice-model");
  });
});
