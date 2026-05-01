import { TFile, type Plugin, type WorkspaceLeaf } from "obsidian";

import type {
  SynchDeletedFile,
  SynchEntryVersion,
  SynchEntryVersionCursor,
  SynchEntryVersionsPage,
} from "./view-models";
import {
  SYNCH_VERSION_HISTORY_VIEW_TYPE,
  SynchVersionHistoryView,
  type VersionHistoryViewController,
  type VersionHistoryViewState,
} from "./version-history-view";
import { shouldSyncPath, type SyncFileRules } from "../sync/core/file-rules";
import type { EntryVersion } from "../sync/remote/realtime-client";
import type { SyncController } from "../sync/runtime/controller";
import type { DeletedSyncEntryRow } from "../sync/store/store";

export interface SynchVersionHistoryControllerDeps {
  plugin: Plugin;
  syncController: SyncController;
  getSyncFileRules: () => SyncFileRules;
  hasAuthenticatedSession: () => boolean;
  hasConnectedRemoteVault: () => boolean;
  refreshUi: () => void;
}

export class SynchVersionHistoryController
  implements VersionHistoryViewController
{
  private readonly activeFileVersionsById = new Map<string, EntryVersion>();

  constructor(private readonly deps: SynchVersionHistoryControllerDeps) {}

  async ensurePane(): Promise<void> {
    await this.getOrCreatePaneLeaf({ active: false, reveal: false });
  }

  async openPane(): Promise<void> {
    const leaf = await this.getOrCreatePaneLeaf({ active: true, reveal: true });
    this.deps.plugin.app.workspace.revealLeaf(leaf);
  }

  private async getOrCreatePaneLeaf(options: {
    active: boolean;
    reveal: boolean;
  }): Promise<WorkspaceLeaf> {
    return await this.deps.plugin.app.workspace.ensureSideLeaf(
      SYNCH_VERSION_HISTORY_VIEW_TYPE,
      "right",
      {
        active: options.active,
        reveal: options.reveal,
        split: false,
      },
    );
  }

  async listActiveFileVersions(
    before: SynchEntryVersionCursor | null,
    limit: number,
  ): Promise<VersionHistoryViewState> {
    if (!this.deps.hasAuthenticatedSession() || !this.deps.hasConnectedRemoteVault()) {
      return {
        status: "not_connected",
        message: "Connect and sign in before viewing version history.",
      };
    }

    const file = this.deps.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      return {
        status: "no_active_file",
        message: "Open a synced file to view its history.",
      };
    }

    if (!shouldSyncPath(file.path, this.deps.getSyncFileRules())) {
      return {
        status: "not_syncable",
        path: file.path,
        message: "This file is excluded from Synch.",
      };
    }

    const page = await this.deps.syncController.listEntryVersionsForPath(
      file.path,
      before,
      limit,
    );
    if (!page) {
      return {
        status: "not_synced",
        path: file.path,
        message: "This file has not synced yet.",
      };
    }

    if (!before) {
      this.activeFileVersionsById.clear();
    }
    for (const version of page.versions) {
      this.activeFileVersionsById.set(version.versionId, version);
    }

    return {
      status: "ready",
      ...toSynchEntryVersionsPage(page),
    };
  }

  async restoreActiveFileVersion(versionId: string): Promise<void> {
    const file = this.deps.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      throw new Error("Open a synced file before restoring version history.");
    }
    const version = this.activeFileVersionsById.get(versionId);
    if (!version) {
      throw new Error("Refresh version history before restoring this version.");
    }
    await this.deps.syncController.restoreEntryVersionForPath(file.path, version);
    this.deps.refreshUi();
  }

  async listDeletedFiles(): Promise<SynchDeletedFile[]> {
    if (!this.deps.hasAuthenticatedSession() || !this.deps.hasConnectedRemoteVault()) {
      throw new Error("Connect and sign in before viewing deleted files.");
    }

    return (await this.deps.syncController.listDeletedEntries()).map(
      toSynchDeletedFile,
    );
  }

  async restoreDeletedFiles(entryIds: string[]): Promise<void> {
    if (!this.deps.hasAuthenticatedSession() || !this.deps.hasConnectedRemoteVault()) {
      throw new Error("Connect and sign in before restoring deleted files.");
    }

    for (const entryId of entryIds) {
      await this.deps.syncController.restoreDeletedEntry(entryId);
    }
    this.deps.refreshUi();
  }

  refreshViews(): void {
    for (const leaf of this.deps.plugin.app.workspace.getLeavesOfType(
      SYNCH_VERSION_HISTORY_VIEW_TYPE,
    )) {
      const view = leaf.view;
      if (view instanceof SynchVersionHistoryView) {
        void view.refresh();
      }
    }
  }
}

function toSynchEntryVersionsPage(page: {
  path: string;
  dirty: boolean;
  versions: EntryVersion[];
  hasMore: boolean;
  nextBefore: SynchEntryVersionCursor | null;
}): SynchEntryVersionsPage {
  return {
    path: page.path,
    dirty: page.dirty,
    versions: page.versions.map(toSynchEntryVersion),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
  };
}

function toSynchEntryVersion(version: EntryVersion): SynchEntryVersion {
  return {
    versionId: version.versionId,
    sourceRevision: version.sourceRevision,
    op: version.op,
    hasBlob: version.blobId !== null,
    reason: version.reason,
    capturedAt: version.capturedAt,
  };
}

function toSynchDeletedFile(file: DeletedSyncEntryRow): SynchDeletedFile {
  return {
    entryId: file.entryId,
    path: file.path,
    revision: file.revision,
    deletedAt: file.deletedAt,
    dirty: file.dirty,
  };
}
