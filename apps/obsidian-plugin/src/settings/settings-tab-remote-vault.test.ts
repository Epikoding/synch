import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getButtonComponents,
  getCreatedElementTexts,
  getMarkdownRenderCalls,
  getSettingDescriptions,
  getSettingNames,
  getToggleComponents,
  resetObsidianMocks,
} from "../test-stubs/obsidian";
import { createSettingsTab, nextTask } from "./__tests__/settings-tab-helpers";

describe("SynchSettingTab remote vault settings", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("shows a remote vault management button after sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(buttonTexts).toContain("Manage remote vaults");
  });

  it("places remote vault management below authentication", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      isDeviceLoginInProgress: () => false,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(buttonTexts.slice(0, 2)).toEqual(["Sign out", "Manage remote vaults"]);
  });

  it("shows deleted file restore controls only for connected vaults", () => {
    const disconnected = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => false,
    });

    disconnected.display();

    expect(getSettingNames()).not.toContain("Deleted files");
    expect(getButtonComponents().map((button) => button.text)).not.toContain(
      "View deleted files",
    );

    resetObsidianMocks();

    const connected = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
    });

    connected.display();

    expect(getSettingNames()).toContain("Deleted files");
    expect(getButtonComponents().map((button) => button.text)).toContain(
      "View deleted files",
    );
  });

  it("shows an empty deleted files modal", async () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      listDeletedFiles: vi.fn(async () => []),
    });

    tab.display();
    await getButtonComponents()
      .find((button) => button.text === "View deleted files")
      ?.click();
    await nextTask();

    expect(getCreatedElementTexts()).toContain(
      "No synced deleted files are available to restore.",
    );
    expect(
      getButtonComponents().find((button) => button.text === "Restore selected")
        ?.disabled,
    ).toBe(true);
  });

  it("restores selected deleted files from the modal", async () => {
    const restoreDeletedFiles = vi.fn(async () => {});
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      listDeletedFiles: vi.fn(async () => [
        {
          entryId: "entry-ready",
          path: "Notes/ready.md",
          revision: 3,
          deletedAt: 1,
          dirty: false,
        },
        {
          entryId: "entry-dirty",
          path: "Notes/dirty.md",
          revision: 4,
          deletedAt: 2,
          dirty: true,
        },
      ]),
      restoreDeletedFiles,
    });

    tab.display();
    await getButtonComponents()
      .find((button) => button.text === "View deleted files")
      ?.click();
    await nextTask();

    const modalToggles = getToggleComponents().slice(-2);
    expect(modalToggles[0]?.disabled).toBe(false);
    expect(modalToggles[1]?.disabled).toBe(true);
    expect(getSettingNames()).toContain("Notes/ready.md");
    expect(getSettingNames()).toContain("Notes/dirty.md");
    expect(getSettingDescriptions()).toContain("Sync first");

    await modalToggles[0]?.change(true);
    await getButtonComponents()
      .find((button) => button.text === "Restore selected (1)")
      ?.click();
    await nextTask();

    expect(restoreDeletedFiles).toHaveBeenCalledWith(["entry-ready"]);
  });

  it("previews deleted files from the modal", async () => {
    const previewDeletedFile = vi.fn(async () => ({
      status: "text" as const,
      path: "Notes/ready.md",
      reason: "before_delete" as const,
      capturedAt: 1,
      text: "previous content",
    }));
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      listDeletedFiles: vi.fn(async () => [
        {
          entryId: "entry-ready",
          path: "Notes/ready.md",
          revision: 3,
          deletedAt: 1,
          dirty: false,
        },
      ]),
      previewDeletedFile,
    });

    tab.display();
    await getButtonComponents()
      .find((button) => button.text === "View deleted files")
      ?.click();
    await nextTask();

    expect(getButtonComponents().some((button) => button.text === "Preview")).toBe(true);
    await getButtonComponents()
      .find((button) => button.text === "Preview")
      ?.click();
    await nextTask();

    expect(previewDeletedFile).toHaveBeenCalledWith("entry-ready");
    expect(getMarkdownRenderCalls()).toEqual([
      expect.objectContaining({
        markdown: "previous content",
        sourcePath: "Notes/ready.md",
      }),
    ]);
  });

  it("previews deleted non-markdown text files as raw text", async () => {
    const previewDeletedFile = vi.fn(async () => ({
      status: "text" as const,
      path: "Notes/ready.txt",
      reason: "before_delete" as const,
      capturedAt: 1,
      text: "previous content",
    }));
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      listDeletedFiles: vi.fn(async () => [
        {
          entryId: "entry-ready",
          path: "Notes/ready.txt",
          revision: 3,
          deletedAt: 1,
          dirty: false,
        },
      ]),
      previewDeletedFile,
    });

    tab.display();
    await getButtonComponents()
      .find((button) => button.text === "View deleted files")
      ?.click();
    await nextTask();
    await getButtonComponents()
      .find((button) => button.text === "Preview")
      ?.click();
    await nextTask();

    expect(getMarkdownRenderCalls()).toEqual([]);
    expect(getCreatedElementTexts()).toContain("previous content");
  });

  it("does not show vault configuration sync controls after sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
    });

    tab.display();

    expect(getSettingNames()).not.toEqual(
      expect.arrayContaining([
        "Vault configuration sync",
        "App settings",
        "Appearance, themes, and snippets",
        "Hotkeys",
        "Core plugin list",
        "Core plugin settings",
        "Community plugin list",
      ]),
    );
  });
});
