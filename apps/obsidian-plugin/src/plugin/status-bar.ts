import type { Plugin } from "obsidian";

export interface SynchStatusBarState {
  getSyncStatusLabel(): string;
}

export function formatStatusBarSyncLabel(label: string): string {
  return label.replace(/\s+\d+%$/, "");
}

export class SynchStatusBar {
  private statusBar: HTMLElement | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly state: SynchStatusBarState,
  ) {}

  initialize(): void {
    this.statusBar = this.plugin.addStatusBarItem();
    this.refresh();
  }

  refresh(): void {
    if (!this.statusBar) {
      return;
    }

    this.statusBar.setText(formatStatusBarSyncLabel(this.state.getSyncStatusLabel()));
  }
}
