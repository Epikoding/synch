import { App, Modal, Notice, Setting } from "obsidian";

import type { SynchDeletedFile } from "../../plugin/view-models";
import { formatDeletedFileTimestamp } from "./format";

export class ExcludedFoldersModal extends Modal {
  private readonly selectedFolders: Set<string>;

  constructor(
    app: App,
    private readonly options: {
      availableFolders: string[];
      initialSelection: string[];
      onSubmit: (paths: string[]) => Promise<void>;
    },
  ) {
    super(app);
    this.selectedFolders = new Set(options.initialSelection);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName("Excluded folders").setHeading();
    contentEl.createEl("p", {
      text: "Select folders that should never sync from this device.",
    });

    if (this.options.availableFolders.length === 0) {
      contentEl.createEl("p", {
        text: "No folders are currently available to exclude.",
      });
    } else {
      for (const folder of this.options.availableFolders) {
        new Setting(contentEl)
          .setName(folder)
          .addToggle((toggle) =>
            toggle.setValue(this.selectedFolders.has(folder)).onChange((value) => {
              if (value) {
                this.selectedFolders.add(folder);
              } else {
                this.selectedFolders.delete(folder);
              }
            }),
          );
      }
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Done").setCta().onClick(() => {
          void this.options.onSubmit(
            [...this.selectedFolders].sort((a, b) => a.localeCompare(b)),
          );
          this.close();
        }),
      );
  }
}

export class DeletedFilesModal extends Modal {
  private readonly selectedEntryIds = new Set<string>();
  private deletedFiles: SynchDeletedFile[] = [];
  private loading = false;
  private error: string | null = null;

  constructor(
    app: App,
    private readonly options: {
      listDeletedFiles: () => Promise<SynchDeletedFile[]>;
      restoreDeletedFiles: (entryIds: string[]) => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    void this.loadDeletedFiles();
  }

  private async loadDeletedFiles(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      this.deletedFiles = await this.options.listDeletedFiles();
      for (const entryId of [...this.selectedEntryIds]) {
        if (!this.deletedFiles.some((file) => file.entryId === entryId && !file.dirty)) {
          this.selectedEntryIds.delete(entryId);
        }
      }
    } catch (error) {
      this.deletedFiles = [];
      this.selectedEntryIds.clear();
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName("Deleted files").setHeading();

    if (this.error) {
      contentEl.createEl("p", {
        cls: "synch-modal-error",
        text: this.error,
      });
    } else {
      contentEl.createEl("p", {
        cls: "synch-modal-hint",
        text: "Select synced deleted files to restore.",
      });
    }

    if (this.loading) {
      contentEl.createEl("p", {
        cls: "synch-modal-empty",
        text: "Loading deleted files...",
      });
    } else if (!this.error && this.deletedFiles.length === 0) {
      contentEl.createEl("p", {
        cls: "synch-modal-empty",
        text: "No synced deleted files are available to restore.",
      });
    } else {
      for (const file of this.deletedFiles) {
        const setting = new Setting(contentEl)
          .setName(file.path)
          .setDesc(
            file.dirty
              ? "Sync first"
              : `Deleted ${formatDeletedFileTimestamp(file.deletedAt)}`,
          );
        setting.addToggle((toggle) => {
          toggle
            .setValue(this.selectedEntryIds.has(file.entryId))
            .setDisabled(file.dirty || this.loading)
            .onChange((value) => {
              if (value) {
                this.selectedEntryIds.add(file.entryId);
              } else {
                this.selectedEntryIds.delete(file.entryId);
              }
              this.render();
            });
        });
      }
    }

    const selectedCount = this.selectedEntryIds.size;
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Refresh").setDisabled(this.loading).onClick(() => {
          void this.loadDeletedFiles();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(
            selectedCount > 0
              ? `Restore selected (${selectedCount})`
              : "Restore selected",
          )
          .setCta()
          .setDisabled(this.loading || selectedCount === 0)
          .onClick(() => {
            void this.restoreSelected();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Close").onClick(() => {
          this.close();
        }),
      );
  }

  private async restoreSelected(): Promise<void> {
    const entryIds = [...this.selectedEntryIds];
    if (entryIds.length === 0) {
      return;
    }

    this.loading = true;
    this.render();

    let restored = 0;
    let failed = 0;
    for (const entryId of entryIds) {
      try {
        await this.options.restoreDeletedFiles([entryId]);
        restored += 1;
        this.selectedEntryIds.delete(entryId);
      } catch {
        failed += 1;
      }
    }

    const parts = [`${restored} restored`];
    if (failed > 0) {
      parts.push(`${failed} failed`);
    }
    new Notice(`Deleted file restore finished: ${parts.join(", ")}.`);
    await this.loadDeletedFiles();
  }
}
