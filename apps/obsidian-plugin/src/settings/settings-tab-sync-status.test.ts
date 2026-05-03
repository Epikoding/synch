import { beforeEach, describe, expect, it } from "vitest";

import {
  getExtraButtonComponents,
  getProgressBarComponents,
  getSettingDescriptions,
  getSettingNames,
  resetObsidianMocks,
} from "../test-stubs/obsidian";
import { createSettingsTab } from "./__tests__/settings-tab-helpers";

describe("SynchSettingTab sync status", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("shows sync progress percent after sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncStatusLabel: () => "Sync: not ready 0%",
      getSyncPercent: () => 0,
      getSyncProgress: () => ({
        completedEntries: 0,
        totalEntries: 0,
      }),
    });

    tab.display();

    expect(getProgressBarComponents()[0]?.value).toBe(0);
  });

  it("prompts users to connect a remote vault before showing sync progress", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => false,
      getSyncState: () => "syncing",
      getSyncStatusLabel: () => "Sync: syncing 37%",
      getSyncPercent: () => 37,
      getSyncProgress: () => ({
        completedEntries: 42,
        totalEntries: 113,
      }),
      getStorageStatus: () => ({
        storageUsedBytes: 24_300_000,
        storageLimitBytes: 50_000_000,
      }),
    });

    tab.display();

    expect(getSettingNames()).toContain("Sync");
    expect(getSettingNames()).not.toContain("Storage");
    expect(getSettingDescriptions()[0]).toBe(
      "Connect a remote vault to start syncing.",
    );
    expect(getProgressBarComponents()).toEqual([]);
    expect(getExtraButtonComponents()).toEqual([]);
  });

  it("places authentication below sync after sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      isDeviceLoginInProgress: () => false,
    });

    tab.display();

    expect(getSettingNames().slice(0, 5)).toEqual([
      "Synch",
      "Sync",
      "Authentication",
      "Vault management",
      "Vault",
    ]);
  });

  it("shows sync progress when entries are syncing", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncState: () => "syncing",
      getSyncStatusLabel: () => "Sync: syncing 37%",
      getSyncPercent: () => 37,
      getSyncProgress: () => ({
        completedEntries: 42,
        totalEntries: 113,
      }),
    });

    tab.display();

    expect(getProgressBarComponents()[0]?.value).toBe(37);
  });

  it("shows a spinner while sync is active", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncState: () => "syncing",
      getSyncStatusLabel: () => "Sync: syncing 37%",
    });

    tab.display();

    expect(getExtraButtonComponents()[0]).toMatchObject({
      disabled: true,
      icon: "loader-circle",
      tooltip: "Sync in progress",
    });
    expect(getExtraButtonComponents()[0]?.extraSettingsEl.classes).toContain(
      "synch-sync-spinner",
    );
  });

  it("shows a spinner while sync is reconnecting", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncState: () => "reconnecting",
      getSyncStatusLabel: () => "Sync: reconnecting 0%",
    });

    tab.display();

    expect(getExtraButtonComponents()).toHaveLength(1);
  });

  it("does not show a spinner while sync is offline", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncState: () => "offline",
      getSyncStatusLabel: () => "Sync: offline 0%",
    });

    tab.display();

    expect(getExtraButtonComponents()).toEqual([]);
  });

  it("hides the sync spinner when sync is idle", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncState: () => "up_to_date",
      getSyncStatusLabel: () => "Sync: up to date 100%",
    });

    tab.display();

    expect(getExtraButtonComponents()).toEqual([]);
  });

  it("shows remote storage usage below the sync status when available", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncStatusLabel: () => "Sync: synced 100%",
      getSyncPercent: () => 100,
      getSyncProgress: () => ({
        completedEntries: 12,
        totalEntries: 12,
      }),
      getStorageStatus: () => ({
        storageUsedBytes: 24_300_000,
        storageLimitBytes: 50_000_000,
      }),
    });

    tab.display();

    expect(getSettingNames().slice(1, 3)).toEqual(["Sync", "Storage"]);
    expect(getSettingDescriptions()[0]).toBe(
      "Sync: synced 100% - 12 / 12",
    );
    expect(getSettingDescriptions()[1]).toBe("24.3 MB / 50 MB (49%)");
    expect(getProgressBarComponents().map(({ value }) => value)).toEqual([
      100,
      49,
    ]);
  });

  it("shows unlimited remote storage usage without a zero-byte limit", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncStatusLabel: () => "Sync: synced 100%",
      getSyncProgress: () => ({
        completedEntries: 12,
        totalEntries: 12,
      }),
      getStorageStatus: () => ({
        storageUsedBytes: 24_300_000,
        storageLimitBytes: 0,
      }),
    });

    tab.display();

    expect(getSettingNames().slice(1, 3)).toEqual(["Sync", "Storage"]);
    expect(getSettingDescriptions()[0]).toBe(
      "Sync: synced 100% - 12 / 12",
    );
    expect(getSettingDescriptions()[1]).toBe("24.3 MB");
    expect(getProgressBarComponents()[1]?.value).toBe(0);
  });

  it("reserves the storage row before the websocket reports usage", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      getSyncStatusLabel: () => "Sync: synced 100%",
      getSyncProgress: () => ({
        completedEntries: 12,
        totalEntries: 12,
      }),
      getStorageStatus: () => null,
    });

    tab.display();

    expect(getSettingNames().slice(1, 3)).toEqual(["Sync", "Storage"]);
    expect(getSettingDescriptions()[0]).toBe("Sync: synced 100% - 12 / 12");
    expect(getSettingDescriptions()[1]).toBe("Checking storage usage...");
    expect(getProgressBarComponents().map(({ value }) => value)).toEqual([
      0,
      0,
    ]);
  });
});
