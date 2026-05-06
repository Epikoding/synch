import type { Plugin, TAbstractFile, TFile } from "obsidian";

import type { SyncFileRules } from "../core/file-rules";
import { asSyncableFile, isSyncableVaultPath, toArrayBuffer } from "./vault-files";

export interface SyncVaultFile {
  path: string;
  mtime: number;
  size: number;
  readBytes(): Promise<Uint8Array>;
}

export class ObsidianSyncVaultAdapter {
  constructor(
    private readonly plugin: Plugin,
    private readonly getSyncFileRules: () => SyncFileRules,
  ) {}

  asSyncableFile(file: TAbstractFile): TFile | null {
    return asSyncableFile(file, this.getSyncFileRules());
  }

  isSyncablePath(path: string): boolean {
    return isSyncableVaultPath(path, this.getSyncFileRules());
  }

  async listFiles(): Promise<SyncVaultFile[]> {
    const files = this.plugin.app.vault
      .getFiles()
      .filter((file) => this.isSyncablePath(file.path));

    return files.map((file) => ({
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      readBytes: async () => await this.readFile(file),
    }));
  }

  async readFile(file: TFile): Promise<Uint8Array> {
    return new Uint8Array(await this.plugin.app.vault.readBinary(file));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.plugin.app.vault.adapter.readBinary(path));
  }

  async exists(path: string): Promise<boolean> {
    return await this.plugin.app.vault.adapter.exists(path);
  }

  async mkdir(path: string): Promise<void> {
    await this.plugin.app.vault.adapter.mkdir(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.plugin.app.vault.adapter.write(path, content);
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    await this.plugin.app.vault.adapter.writeBinary(path, toArrayBuffer(content));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.plugin.app.vault.adapter.rename(oldPath, newPath);
  }

  async remove(path: string): Promise<void> {
    await this.plugin.app.vault.adapter.remove(path);
  }
}
