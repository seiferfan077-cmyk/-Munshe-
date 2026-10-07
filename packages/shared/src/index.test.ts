import { describe, expect, it } from "vitest";
import {
  BUILD_STATUSES,
  normalizePublicGitHubRepoUrl,
  STATUS_LABELS_AR,
} from "./index.js";

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

describe("normalizePublicGitHubRepoUrl", () => {
  it("normalizes repository root links to a canonical HTTPS clone URL", () => {
    expect(normalizePublicGitHubRepoUrl("https://github.com/org/app")).toBe(
      "https://github.com/org/app.git",
    );
    expect(
      normalizePublicGitHubRepoUrl("https://github.com/org/app.git/"),
    ).toBe("https://github.com/org/app.git");
  });

  it.each([
    "http://github.com/org/app",
    "https://github.com/org/app/tree/main",
    "https://github.com.evil.example/org/app",
    "https://user@github.com/org/app",
    "https://github.com/org/app?tab=readme",
    "https://github.com/org/app#readme",
    "https://github.com/org/../secret",
    "file:///etc/passwd",
    "not a URL",
  ])("rejects unsupported or unsafe links: %s", (url) => {
    expect(normalizePublicGitHubRepoUrl(url)).toBeNull();
  });
});
