import { Modal, Setting, type App } from "obsidian";

import type { SynchVersionPreview } from "./view-models";

export class VersionPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly preview: SynchVersionPreview,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName("Version preview").setHeading();
    contentEl.createEl("div", {
      cls: "synch-preview-path",
      text: this.preview.path,
    });

    const meta = formatPreviewMeta(this.preview);
    if (meta) {
      contentEl.createEl("div", {
        cls: "synch-preview-meta",
        text: meta,
      });
    }

    if (this.preview.status === "unavailable") {
      contentEl.createEl("p", {
        cls: "synch-modal-empty",
        text: this.preview.message,
      });
      return;
    }

    contentEl.createEl("pre", {
      cls: "synch-preview-content",
      text: this.preview.text,
    });
  }
}

function formatPreviewMeta(preview: SynchVersionPreview): string {
  const parts: string[] = [];
  if (preview.capturedAt !== null) {
    parts.push(new Date(preview.capturedAt).toLocaleString());
  }
  if (preview.reason) {
    parts.push(formatReason(preview.reason));
  }
  return parts.join(" · ");
}

function formatReason(reason: NonNullable<SynchVersionPreview["reason"]>): string {
  if (reason === "before_delete") {
    return "Before delete";
  }
  if (reason === "before_restore") {
    return "Before restore";
  }
  if (reason === "manual") {
    return "Manual";
  }
  return "Auto";
}
