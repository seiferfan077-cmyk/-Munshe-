import { describe, expect, it } from "vitest";
import { BUILD_STATUSES, STATUS_LABELS_AR } from "./index.js";

describe("build statuses", () => {
  it("provides a label for every build state", () => {
    expect(Object.keys(STATUS_LABELS_AR).sort()).toEqual(
      [...BUILD_STATUSES].sort(),
    );
  });
  it("keeps the core Arabic product states", () => {
    expect(STATUS_LABELS_AR.completed).toContain("التطبيق خلص");
    expect(STATUS_LABELS_AR.failed).toContain("مشكلة أثناء البناء");
  });
});
