import { App, Modal, Notice, Setting } from "obsidian";

import type {
  SynchDeletedFileCursor,
  SynchDeletedFilesPage,
  SynchDeletedFile,
  SynchVersionPreview,
} from "../../plugin/view-models";
import { VersionPreviewModal } from "../../plugin/version-preview-modal";
import { formatDeletedFileTimestamp } from "./format";

const DELETED_FILES_PAGE_SIZE = 25;

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
  private nextBefore: SynchDeletedFileCursor | null = null;
  private hasMore = false;
  private loading = false;
  private previewingEntryId: string | null = null;
  private error: string | null = null;

  constructor(
    app: App,
    private readonly options: {
      listDeletedFiles: (
        before: SynchDeletedFileCursor | null,
        limit: number,
      ) => Promise<SynchDeletedFilesPage>;
      previewDeletedFile: (
        entryId: string,
        fallbackPath: string,
      ) => Promise<SynchVersionPreview>;
      restoreDeletedFiles: (files: SynchDeletedFile[]) => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    void this.loadDeletedFiles();
  }

  private async loadDeletedFiles(): Promise<void> {
    this.deletedFiles = [];
    this.nextBefore = null;
    this.hasMore = false;
    await this.loadDeletedFilesPage(null);
  }

  private async loadMoreDeletedFiles(): Promise<void> {
    if (!this.hasMore || this.loading) {
      return;
    }
    await this.loadDeletedFilesPage(this.nextBefore);
  }

  private async loadDeletedFilesPage(
    before: SynchDeletedFileCursor | null,
  ): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const page = await this.options.listDeletedFiles(
        before,
        DELETED_FILES_PAGE_SIZE,
      );
      this.deletedFiles =
        before === null ? page.files : [...this.deletedFiles, ...page.files];
      this.hasMore = page.hasMore;
      this.nextBefore = page.nextBefore;
      for (const entryId of [...this.selectedEntryIds]) {
        if (!this.deletedFiles.some((file) => file.entryId === entryId)) {
          this.selectedEntryIds.delete(entryId);
        }
      }
    } catch (error) {
      if (before === null) {
        this.deletedFiles = [];
        this.selectedEntryIds.clear();
        this.hasMore = false;
        this.nextBefore = null;
      }
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("synch-deleted-files-modal");
    const headerEl = contentEl.createEl("div", {
      cls: "synch-deleted-files-header",
    });
    const listEl = contentEl.createEl("div", {
      cls: "synch-deleted-files-list",
    });
    const footerEl = contentEl.createEl("div", {
      cls: "synch-deleted-files-footer",
    });
    new Setting(headerEl).setName("Deleted files").setHeading();

    if (this.error) {
      headerEl.createEl("p", {
        cls: "synch-modal-error",
        text: this.error,
      });
    } else {
      headerEl.createEl("p", {
        cls: "synch-modal-hint",
        text: "Select synced deleted files to restore.",
      });
    }

    if (this.loading) {
      listEl.createEl("p", {
        cls: "synch-modal-empty",
        text: "Loading deleted files...",
      });
    } else if (!this.error && this.deletedFiles.length === 0) {
      listEl.createEl("p", {
        cls: "synch-modal-empty",
        text: "No synced deleted files are available to restore.",
      });
    } else {
      for (const file of this.deletedFiles) {
        const previewing = this.previewingEntryId === file.entryId;
        const setting = new Setting(listEl)
          .setName(file.path)
          .setDesc(`Deleted ${formatDeletedFileTimestamp(file.deletedAt)}`);
        setting.addButton((button) => {
          button
            .setButtonText(previewing ? "Loading preview..." : "Preview")
            .setDisabled(this.loading || previewing)
            .onClick(() => {
              void this.previewDeletedFile(file);
            });
        });
        setting.addToggle((toggle) => {
          toggle
            .setValue(this.selectedEntryIds.has(file.entryId))
            .setDisabled(this.loading)
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
    const actions = new Setting(footerEl).addButton((button) =>
      button.setButtonText("Refresh").setDisabled(this.loading).onClick(() => {
        void this.loadDeletedFiles();
      }),
    );
    if (this.hasMore) {
      actions.addButton((button) =>
        button
          .setButtonText("Load more")
          .setDisabled(this.loading)
          .onClick(() => {
            void this.loadMoreDeletedFiles();
          }),
      );
    }
    actions
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
    const selectedFiles = this.deletedFiles.filter((file) =>
      this.selectedEntryIds.has(file.entryId),
    );
    if (selectedFiles.length === 0) {
      return;
    }

    this.loading = true;
    this.render();

    let restored = 0;
    let failed = 0;
    for (const file of selectedFiles) {
      try {
        await this.options.restoreDeletedFiles([file]);
        restored += 1;
        this.selectedEntryIds.delete(file.entryId);
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

  private async previewDeletedFile(file: SynchDeletedFile): Promise<void> {
    if (this.previewingEntryId !== null) {
      return;
    }

    this.previewingEntryId = file.entryId;
    this.render();

    try {
      const preview = await this.options.previewDeletedFile(file.entryId, file.path);
      new VersionPreviewModal(this.app, preview).open();
    } catch (error) {
      new Notice(
        `Deleted file preview failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.previewingEntryId = null;
      this.render();
    }
  }
}
