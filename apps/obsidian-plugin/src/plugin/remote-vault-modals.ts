import { App, Modal, Setting } from "obsidian";

import type {
  BootstrapRemoteVaultInput,
  CreateRemoteVaultInput,
} from "../remote-vault/manager";
import { validateVaultPassword } from "../remote-vault/password-policy";
import type { RemoteVaultRecord } from "../remote-vault/types";

export async function openCreateRemoteVaultModal(
  app: App,
  initialVaultName: string,
): Promise<CreateRemoteVaultInput | null> {
  const modal = new CreateRemoteVaultModal(app, initialVaultName);
  return await modal.openAndWait();
}

export async function openBootstrapRemoteVaultModal(
  app: App,
  vaults: RemoteVaultRecord[],
  preferredVaultId: string | null,
): Promise<BootstrapRemoteVaultInput | null> {
  const modal = new BootstrapRemoteVaultModal(app, vaults, preferredVaultId);
  return await modal.openAndWait();
}

export async function openConfirmConnectNonEmptyLocalVaultModal(
  app: App,
): Promise<boolean> {
  const modal = new ConfirmConnectNonEmptyLocalVaultModal(app);
  return await modal.openAndWait();
}

class CreateRemoteVaultModal extends Modal {
  private resolver: ((value: CreateRemoteVaultInput | null) => void) | null = null;
  private result: CreateRemoteVaultInput | null = null;
  private vaultName: string;
  private password = "";
  private confirmPassword = "";

  constructor(app: App, initialVaultName: string) {
    super(app);
    this.vaultName = initialVaultName;
  }

  async openAndWait(): Promise<CreateRemoteVaultInput | null> {
    return await new Promise<CreateRemoteVaultInput | null>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    let createButton: { setDisabled(value: boolean): unknown } | null = null;
    const updateCreateButtonState = (): void => {
      const validationError = this.getValidationError();
      createButton?.setDisabled(validationError !== null);
    };
    let passwordErrorEl: { setText(value: string): unknown } | null = null;
    const updatePasswordError = (): void => {
      passwordErrorEl?.setText(this.getPasswordValidationError() ?? "");
    };

    contentEl.createEl("h2", { text: "Create Vault" });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "Create a new vault and wrap its vault key with a password on this device.",
    });

    new Setting(contentEl)
      .setName("Vault name")
      .setDesc("A display name for this vault. The server will generate the vault ID.")
      .addText((text) => {
        text.setPlaceholder("Personal").setValue(this.vaultName).onChange((value) => {
          this.vaultName = value.trim();
          updateCreateButtonState();
        });
      });

    new Setting(contentEl)
      .setName("Password")
      .setDesc("Used to wrap the vault key locally before upload.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "new-password";
        text.setPlaceholder("Enter vault password").onChange((value) => {
          this.password = value;
          updatePasswordError();
          updateCreateButtonState();
        });
      });

    new Setting(contentEl)
      .setName("Confirm password")
      .setDesc("Repeat the same password.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "new-password";
        text.setPlaceholder("Repeat vault password").onChange((value) => {
          this.confirmPassword = value;
          updatePasswordError();
          updateCreateButtonState();
        });
      });

    passwordErrorEl = contentEl.createEl("p", {
      cls: "synch-modal-error",
    });
    updatePasswordError();

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Create vault").setCta().onClick(async () => {
          if (this.getValidationError() !== null) {
            updatePasswordError();
            updateCreateButtonState();
            return;
          }

          const confirmed = await new ConfirmCreateRemoteVaultBackupModal(this.app).openAndWait();
          if (!confirmed) {
            return;
          }

          this.result = {
            name: this.vaultName,
            password: this.password,
            confirmPassword: this.confirmPassword,
          };
          this.close();
        });
        createButton = button;
        updateCreateButtonState();
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolver?.(this.result);
    this.resolver = null;
  }

  private getValidationError(): string | null {
    if (!this.vaultName.trim()) {
      return "Vault name is required.";
    }

    const passwordValidation = validateVaultPassword(this.password);
    if (!passwordValidation.ok) {
      return passwordValidation.message;
    }

    if (this.password !== this.confirmPassword) {
      return "Passwords do not match.";
    }

    return null;
  }

  private getPasswordValidationError(): string | null {
    if (this.password === "" && this.confirmPassword === "") {
      return null;
    }

    const passwordValidation = validateVaultPassword(this.password);
    if (!passwordValidation.ok) {
      return passwordValidation.message;
    }

    if (this.confirmPassword !== "" && this.password !== this.confirmPassword) {
      return "Passwords do not match.";
    }

    return null;
  }
}

class ConfirmCreateRemoteVaultBackupModal extends Modal {
  private resolver: ((value: boolean) => void) | null = null;
  private confirmed = false;

  async openAndWait(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Back Up Your Vault" });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "Creating a remote vault can affect this local Obsidian vault's file structure or sync state.",
    });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "Back up your vault before continuing.",
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("I backed up, create vault").setCta().onClick(() => {
          this.confirmed = true;
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolver?.(this.confirmed);
    this.resolver = null;
  }
}

class ConfirmConnectNonEmptyLocalVaultModal extends Modal {
  private resolver: ((value: boolean) => void) | null = null;
  private confirmed = false;

  async openAndWait(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Connect Vault" });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "This local vault already contains files.",
    });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "Connecting it may cause unexpected sync conflicts.",
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Connect anyway").setCta().onClick(() => {
          this.confirmed = true;
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolver?.(this.confirmed);
    this.resolver = null;
  }
}

class BootstrapRemoteVaultModal extends Modal {
  private resolver: ((value: BootstrapRemoteVaultInput | null) => void) | null = null;
  private result: BootstrapRemoteVaultInput | null = null;
  private readonly vaults: RemoteVaultRecord[];
  private selectedVaultId: string;
  private password = "";

  constructor(app: App, vaults: RemoteVaultRecord[], preferredVaultId: string | null) {
    super(app);
    this.vaults = vaults;
    this.selectedVaultId =
      preferredVaultId && vaults.some((vault) => vault.id === preferredVaultId)
        ? preferredVaultId
        : vaults[0]?.id ?? "";
  }

  async openAndWait(): Promise<BootstrapRemoteVaultInput | null> {
    return await new Promise<BootstrapRemoteVaultInput | null>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Connect Vault" });
    contentEl.createEl("p", {
      cls: "synch-modal-hint",
      text: "Choose a vault from the server, then enter the password to connect it on this device.",
    });

    if (this.vaults.length === 0) {
      contentEl.createEl("p", {
        cls: "synch-modal-empty",
        text: "No vault exists yet for this account.",
      });

      new Setting(contentEl).addButton((button) => {
        button.setButtonText("Close").setCta().onClick(() => {
          this.close();
        });
      });
      return;
    }

    const selectedLabel = contentEl.createEl("p", {
      cls: "synch-modal-selected",
      text: `Selected: ${this.getSelectedVaultLabel()}`,
    });
    const vaultList = contentEl.createEl("div", {
      cls: "synch-vault-list",
    });
    this.renderVaultButtons(vaultList, selectedLabel);

    new Setting(contentEl)
      .setName("Password")
      .setDesc("Used locally to unwrap the vault key.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "current-password";
        text.setPlaceholder("Enter vault password").onChange((value) => {
          this.password = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Connect vault").setCta().onClick(() => {
          this.result = {
            vaultId: this.selectedVaultId,
            password: this.password,
          };
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolver?.(this.result);
    this.resolver = null;
  }

  private renderVaultButtons(containerEl: HTMLElement, selectedLabel: HTMLParagraphElement): void {
    containerEl.empty();

    for (const vault of this.vaults) {
      const button = containerEl.createEl("button", {
        cls: "synch-vault-option",
        text: vault.name,
      });
      button.type = "button";

      if (vault.id === this.selectedVaultId) {
        button.addClass("is-selected");
      }

      button.addEventListener("click", () => {
        this.selectedVaultId = vault.id;
        selectedLabel.setText(`Selected: ${this.getSelectedVaultLabel()}`);
        this.renderVaultButtons(containerEl, selectedLabel);
      });

      button.createEl("span", {
        cls: "synch-vault-option-id",
        text: vault.id,
      });
    }
  }

  private getSelectedVaultLabel(): string {
    const selectedVault = this.vaults.find((vault) => vault.id === this.selectedVaultId);
    if (!selectedVault) {
      return "None";
    }

    return `${selectedVault.name} (${selectedVault.id})`;
  }
}
