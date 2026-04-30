import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDefaultApiBaseUrl } from "../config";
import {
  getButtonComponents,
  getProgressBarComponents,
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

    const signInButton = getButtonComponents()[1];
    expect(signInButton?.text).toBe("Open sign-in page again");
    expect(signInButton?.disabled).toBe(false);
  });

  it("shows the normal sign-in button when device login is idle", () => {
    const tab = createSettingsTab({
      isDeviceLoginInProgress: () => false,
    });

    tab.display();

    const signInButton = getButtonComponents()[1];
    expect(signInButton?.text).toBe("Sign in on this device");
    expect(signInButton?.disabled).toBe(false);
  });

  it("hides settings below authentication before sign-in", () => {
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => false,
    });

    tab.display();

    const buttonTexts = getButtonComponents().map((button) => button.text);
    expect(buttonTexts).toEqual(["Save", "Sign in on this device"]);
    expect(getProgressBarComponents()).toEqual([]);
  });

  it("shows an editable API base URL before sign-in", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    expect(apiBaseUrlInput?.value).toBe("https://api.synch.test");
    expect(apiBaseUrlInput?.disabled).toBe(false);

    const saveButton = getButtonComponents()[0];
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
    expect(apiBaseUrlInput?.placeholder).toBe("Default server");

    await getButtonComponents()[0]?.click();
    expect(updateApiBaseUrl).toHaveBeenCalledWith("");
  });

  it("hides the API base URL after sign-in", () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      hasAuthenticatedSession: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    expect(getSettingNames()).not.toContain("API base URL");
    expect(getTextComponents()).toEqual([]);
    expect(getButtonComponents().map((button) => button.text)).not.toContain("Save");
    expect(updateApiBaseUrl).not.toHaveBeenCalled();
  });

  it("disables the API base URL during device sign-in", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      isDeviceLoginInProgress: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    const saveButton = getButtonComponents()[0];
    expect(apiBaseUrlInput?.disabled).toBe(true);
    expect(saveButton?.disabled).toBe(true);

    await apiBaseUrlInput?.change("https://custom.synch.test");
    await saveButton?.click();

    expect(updateApiBaseUrl).not.toHaveBeenCalled();
  });

  it("disables the API base URL while a vault is connected", async () => {
    const updateApiBaseUrl = vi.fn(async () => {});
    const tab = createSettingsTab({
      hasConnectedRemoteVault: () => true,
      getApiBaseUrl: () => "https://api.synch.test",
      updateApiBaseUrl,
    });

    tab.display();

    const apiBaseUrlInput = getTextComponents()[0];
    const saveButton = getButtonComponents()[0];
    expect(apiBaseUrlInput?.disabled).toBe(true);
    expect(saveButton?.disabled).toBe(true);
    expect(getSettingDescriptions()[0]).toBe(
      "Disconnect the current vault before changing the API server.",
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
