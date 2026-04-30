import { Notice, type Plugin } from "obsidian";

export interface SynchCommandController {
  getAuthStatusLabel(): string;
  getRemoteVaultStatusLabel(): string;
  beginDeviceLogin(): Promise<void>;
  signOutDevice(): Promise<void>;
  createRemoteVaultFromPrompt(): Promise<void>;
  connectRemoteVaultFromPrompt(): Promise<void>;
  disconnectRemoteVault(): Promise<void>;
  openVersionHistoryPane(): Promise<void>;
}

export function registerSynchCommands(
  plugin: Plugin,
  controller: SynchCommandController,
): void {
  plugin.addCommand({
    id: "sign-in-on-this-device",
    name: "Sign in on this device",
    callback: async () => {
      await controller.beginDeviceLogin();
    },
  });

  plugin.addCommand({
    id: "sign-out-on-this-device",
    name: "Sign out on this device",
    callback: async () => {
      await controller.signOutDevice();
    },
  });

  plugin.addCommand({
    id: "show-auth-status",
    name: "Show auth status",
    callback: () => {
      new Notice(controller.getAuthStatusLabel());
    },
  });

  plugin.addCommand({
    id: "create-vault",
    name: "Create vault",
    callback: async () => {
      await controller.createRemoteVaultFromPrompt();
    },
  });

  plugin.addCommand({
    id: "connect-vault",
    name: "Connect vault",
    callback: async () => {
      await controller.connectRemoteVaultFromPrompt();
    },
  });

  plugin.addCommand({
    id: "disconnect-vault",
    name: "Disconnect vault",
    callback: async () => {
      await controller.disconnectRemoteVault();
    },
  });

  plugin.addCommand({
    id: "show-vault-status",
    name: "Show vault status",
    callback: () => {
      new Notice(controller.getRemoteVaultStatusLabel());
    },
  });

  plugin.addCommand({
    id: "open-version-history",
    name: "Open version history",
    callback: async () => {
      await controller.openVersionHistoryPane();
    },
  });
}
