import { setIcon, type Plugin } from "obsidian";

import type { SynchSyncState } from "./view-models";

interface ObsidianSettingsApi {
  open(): void;
  openTabById(id: string): void;
}

interface AppWithSettings {
  setting?: ObsidianSettingsApi;
}

export interface SynchStatusBarState {
  getSyncState(): SynchSyncState;
  getSyncPercent(): number;
}

const STATUS_BAR_STATE_CLASSES = [
  "synch-status-not-ready",
  "synch-status-paused",
  "synch-status-syncing",
  "synch-status-offline",
  "synch-status-reconnecting",
  "synch-status-up-to-date",
  "synch-status-attention-needed",
];

export function getStatusBarStateClass(state: SynchSyncState): string {
  switch (state) {
    case "not_ready":
      return "synch-status-not-ready";
    case "paused":
      return "synch-status-paused";
    case "syncing":
      return "synch-status-syncing";
    case "offline":
      return "synch-status-offline";
    case "reconnecting":
      return "synch-status-reconnecting";
    case "up_to_date":
      return "synch-status-up-to-date";
    case "attention_needed":
      return "synch-status-attention-needed";
  }
}

export function getStatusBarIcon(state: SynchSyncState): string {
  switch (state) {
    case "not_ready":
      return "circle";
    case "paused":
      return "pause";
    case "syncing":
    case "reconnecting":
      return "loader-circle";
    case "offline":
      return "wifi-off";
    case "up_to_date":
      return "check";
    case "attention_needed":
      return "triangle-alert";
  }
}

export class SynchStatusBar {
  private statusBar: HTMLElement | null = null;
  private icon: HTMLElement | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly state: SynchStatusBarState,
  ) {}

  initialize(): void {
    this.statusBar = this.plugin.addStatusBarItem();
    this.statusBar.addClass("synch-status-bar");
    this.statusBar.empty();
    this.statusBar.setAttribute("role", "button");
    this.statusBar.setAttribute("aria-label", "Open Synch settings");
    this.icon = this.statusBar.createEl("span", {
      cls: "synch-status-bar-icon",
    });
    this.icon.setAttribute("aria-hidden", "true");
    this.plugin.registerDomEvent(this.statusBar, "click", () => {
      this.openSettings();
    });
    this.refresh();
  }

  refresh(): void {
    if (!this.statusBar) {
      return;
    }

    const state = this.state.getSyncState();

    this.statusBar.addClass("synch-status-bar");
    for (const className of STATUS_BAR_STATE_CLASSES) {
      this.statusBar.removeClass(className);
    }
    this.statusBar.addClass(getStatusBarStateClass(state));
    this.statusBar.toggleClass(
      "synch-status-active",
      state === "syncing" || state === "reconnecting",
    );
    if (this.icon) {
      setIcon(this.icon, getStatusBarIcon(state));
    }
    this.statusBar.removeAttribute("title");
    this.statusBar.setAttribute("aria-label", "Open Synch settings");
    this.statusBar.setAttribute("data-synch-sync-state", state);
    this.statusBar.setAttribute("data-synch-sync-percent", String(this.state.getSyncPercent()));
  }

  private openSettings(): void {
    const settings = (this.plugin.app as AppWithSettings).setting;
    settings?.open();
    settings?.openTabById(this.plugin.manifest.id);
  }
}
