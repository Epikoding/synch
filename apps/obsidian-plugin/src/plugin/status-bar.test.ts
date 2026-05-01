import { describe, expect, it } from "vitest";

import { formatStatusBarSyncLabel } from "./status-bar";

describe("formatStatusBarSyncLabel", () => {
  it("removes the trailing sync percent", () => {
    expect(formatStatusBarSyncLabel("Sync: syncing 37%")).toBe("Sync: syncing");
  });

  it("removes the trailing offline percent", () => {
    expect(formatStatusBarSyncLabel("Sync: offline 0%")).toBe("Sync: offline");
  });

  it("keeps labels without a trailing percent unchanged", () => {
    expect(formatStatusBarSyncLabel("Sync: attention needed")).toBe(
      "Sync: attention needed",
    );
  });
});
