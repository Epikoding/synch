import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDefaultApiBaseUrl } from "../config";
import {
  getButtonComponents,
  getCreatedElementTexts,
  getProgressBarComponents,
  getSettingClasses,
  getSettingDescriptions,
  getSettingNames,
  getTextComponents,
  resetObsidianMocks,
} from "../test-stubs/obsidian";
import { createSettingsTab } from "./__tests__/settings-tab-helpers";

describe("SynchSettingTab", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("offers to reopen the sign-in page while device login is in progress", () => {
    const tab = createSettingsTab({
      isDeviceLoginInProgress: () => true,
    });

    tab.display();

    const signInButton = getButtonComponents()[0];
    expect(signInButton?.text).toBe("Open sign-in page again");
    expect(signInButton?.disabled).toBe(false);
  });

  it("shows the normal sign-in button when device login is idle", () => {
    const tab = createSettingsTab({
      isDeviceLoginInProgress: () => false,
    });

    tab.display();

    const signInButton = getButtonComponents()[0];
    expect(signInButton?.text).toBe("Sign in on this device");
    expect(signInButton?.disabled).toBe(false);
  });

  it("shows account before self-hosted server settings before sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => false,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(getSettingNames().slice(0, 5)).toEqual([
      "Synch",
      "Account",
      "Authentication",
      "Self-hosted server",
      "Server URL",
    ]);
    expect(buttonTexts).toEqual(["Sign in on this device", "Save"]);
    expect(getProgressBarComponents()).toEqual([]);
  });

  it("checks and shows plugin updates beside the settings heading only when needed", () => {
    const ensurePluginUpdateCheck = vi.fn(async () => {});
    const tab = createSettingsTab({
      ensurePluginUpdateCheck,
      getPluginUpdateStatus: () => ({
        state: "update_available",
        currentVersion: "0.0.1",
        latestVersion: "0.0.2",
      }),
    });

    tab.display();

    expect(ensurePluginUpdateCheck).toHaveBeenCalledTimes(1);
    expect(getSettingNames()[0]).toBe("Synch");
    expect(getCreatedElementTexts()).toContain("Update to latest version");
    expect(getSettingDescriptions()[0]).toBe(
      "Version 0.0.2 is available. Current version: 0.0.1.",
    );
    expect(getSettingClasses()[0]).toContain("synch-plugin-update-available");
  });

  it("hides plugin update status from settings when no update is available", () => {
    const tab = createSettingsTab({
      getPluginUpdateStatus: () => ({
        state: "checking",
        currentVersion: "0.0.1",
      }),
    });

    tab.display();

    expect(getSettingNames()).not.toContain("Plugin update");
    expect(getCreatedElementTexts()).not.toContain("Update to latest version");

    resetObsidianMocks();
    createSettingsTab({
      getPluginUpdateStatus: () => ({
        state: "up_to_date",
        currentVersion: "0.0.1",
        latestVersion: "0.0.1",
      }),
    }).display();

    expect(getSettingNames()).not.toContain("Plugin update");
    expect(getSettingClasses()[0]).not.toContain("synch-plugin-update-available");

    resetObsidianMocks();
    createSettingsTab({
      getPluginUpdateStatus: () => ({
        state: "failed",
        currentVersion: "0.0.1",
        error: "offline",
      }),
    }).display();

    expect(getSettingNames()).not.toContain("Plugin update");
    expect(getButtonComponents()[0]?.text).toBe("Sign in on this device");
  });

  it("shows an editable self-hosted server URL before sign-in", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    expect(apiBaseUrlInput?.value).toBe("https://api.synch.test");
    expect(apiBaseUrlInput?.disabled).toBe(false);

    const saveButton = getButtonComponents()[1];
    expect(saveButton?.text).toBe("Save");
    expect(saveButton?.disabled).toBe(false);

    await apiBaseUrlInput?.change("https://custom.synch.test");
    expect(updateApiBaseUrl).not.toHaveBeenCalled();

    await saveButton?.click();
    expect(updateApiBaseUrl).toHaveBeenCalledWith("https://custom.synch.test");
  });

  it("does not show the default API base URL before sign-in", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      getApiBaseUrl: () => getDefaultApiBaseUrl(),
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    expect(apiBaseUrlInput?.value).toBe("");
    expect(apiBaseUrlInput?.placeholder).toBe("Synch Cloud");

    await getButtonComponents()[1]?.click();
    expect(updateApiBaseUrl).toHaveBeenCalledWith("");
  });

  it("hides the self-hosted server URL after sign-in", () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    expect(getSettingNames()).not.toContain("Server URL");
    expect(getTextComponents()).toEqual([]);
    expect(getButtonComponents().map((button) => button.text)).not.toContain("Save");
    expect(updateApiBaseUrl).not.toHaveBeenCalled();
  });

  it("disables the self-hosted server URL during device sign-in", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      isDeviceLoginInProgress: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    const saveButton = getButtonComponents()[1];
    expect(apiBaseUrlInput?.disabled).toBe(true);
    expect(saveButton?.disabled).toBe(true);

    await apiBaseUrlInput?.change("https://custom.synch.test");
    await saveButton?.click();

    expect(updateApiBaseUrl).not.toHaveBeenCalled();
  });

  it("disables the self-hosted server URL while a vault is connected", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      hasConnectedRemoteVault: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    const saveButton = getButtonComponents()[1];
    expect(apiBaseUrlInput?.disabled).toBe(true);
    expect(saveButton?.disabled).toBe(true);
    expect(getSettingDescriptions()[1]).toBe(
      "Disconnect the current vault before changing servers.",
    );

    await apiBaseUrlInput?.change("https://custom.synch.test");
    await saveButton?.click();

    expect(updateApiBaseUrl).not.toHaveBeenCalled();
  });

  it("hides the sign-in button and shows sign out when already signed in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      isDeviceLoginInProgress: () => false,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(buttonTexts).not.toContain("Sign in on this device");
    expect(buttonTexts).not.toContain("Open sign-in page again");
    expect(buttonTexts).toContain("Sign out");
  });

  it("hides sign out before sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => false,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(buttonTexts).toContain("Sign in on this device");
    expect(buttonTexts).not.toContain("Sign out");
  });

  it("watches remote storage usage only while a connected settings tab is visible", () => {
    const watchStorageStatus = vi.fn();
    const unwatchStorageStatus = vi.fn();
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      watchStorageStatus,
      unwatchStorageStatus,
    });

    tab.display();
    tab.display();
    tab.hide();

    expect(watchStorageStatus).toHaveBeenCalledTimes(1);
    expect(unwatchStorageStatus).toHaveBeenCalledTimes(1);
  });

  it("does not watch remote storage usage when a hidden settings tab refreshes", () => {
    const watchStorageStatus = vi.fn();
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => true,
      watchStorageStatus,
    });

    tab.refresh();

    expect(watchStorageStatus).toHaveBeenCalledTimes(0);
  });

  it("does not watch remote storage usage without a connected vault", () => {
    const watchStorageStatus = vi.fn();
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      hasConnectedRemoteVault: () => false,
      watchStorageStatus,
    });

    tab.display();

    expect(watchStorageStatus).toHaveBeenCalledTimes(0);
  });

});
