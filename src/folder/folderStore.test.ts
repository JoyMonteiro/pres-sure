import { afterEach, describe, expect, it } from "vitest";
import { isEditingLocked, useFolderStore } from "./folderStore";

afterEach(() => useFolderStore.setState({ status: "none" }));

describe("isEditingLocked", () => {
  it("locks editing only while the reopen overlay is up", () => {
    for (const status of ["none", "open", "conflict"] as const) {
      useFolderStore.setState({ status });
      expect(isEditingLocked()).toBe(false);
    }
    useFolderStore.setState({ status: "needsPermission" });
    expect(isEditingLocked()).toBe(true);
  });
});
