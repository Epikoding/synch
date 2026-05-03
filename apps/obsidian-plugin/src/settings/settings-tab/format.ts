import type { SynchSyncProgress, SynchSyncState } from "../../plugin/view-models";
import {
  isStorageFullStatus,
  isStorageWarningStatus,
} from "../../utils/storage-warning";
import type { SynchSettingsController } from "../controller";

export function shouldShowSyncSpinner(state: SynchSyncState): boolean {
  return state === "syncing" || state === "reconnecting";
}

export function formatSyncDescription(
  statusLabel: string,
  syncProgress: SynchSyncProgress,
): string {
  const label = statusLabel.replace(/^Sync:\s*/, "").replace(/^paused \d+%$/, "paused");
  return `${label} - ${syncProgress.completedEntries} / ${syncProgress.totalEntries}`;
}

export function formatStorageDescription(
  storageStatus: NonNullable<ReturnType<SynchSettingsController["getStorageStatus"]>>,
): string {
  const usage = formatStorageUsage(storageStatus);
  if (isStorageFullStatus(storageStatus)) {
    return `Storage full: ${usage}`;
  }
  if (isStorageWarningStatus(storageStatus)) {
    return `Storage almost full: ${usage}`;
  }

  return usage;
}

function formatStorageUsage(
  storageStatus: NonNullable<ReturnType<SynchSettingsController["getStorageStatus"]>>,
): string {
  if (storageStatus.storageLimitBytes <= 0) {
    return formatBytes(storageStatus.storageUsedBytes);
  }

  return [
    `${formatBytes(storageStatus.storageUsedBytes)} / ${formatBytes(storageStatus.storageLimitBytes)}`,
    `(${Math.round((storageStatus.storageUsedBytes / storageStatus.storageLimitBytes) * 100)}%)`,
  ].join(" ");
}

export function getStoragePercent(
  storageStatus: NonNullable<ReturnType<SynchSettingsController["getStorageStatus"]>>,
): number {
  if (storageStatus.storageLimitBytes <= 0) {
    return 0;
  }

  const percent = (storageStatus.storageUsedBytes / storageStatus.storageLimitBytes) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function formatDeletedFileTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = safeBytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${safeBytes} B`;
  }

  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${units[unitIndex]}`;
}
