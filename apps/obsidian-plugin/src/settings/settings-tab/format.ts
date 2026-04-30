import type { SynchSyncProgress, SynchSyncState } from "../../plugin/view-models";
import type { SynchSettingsController } from "../controller";

export function shouldShowSyncSpinner(state: SynchSyncState): boolean {
  return state === "syncing" || state === "reconnecting";
}

export function formatSyncDescription(
  statusLabel: string,
  syncProgress: SynchSyncProgress,
  storageStatus: ReturnType<SynchSettingsController["getStorageStatus"]>,
): string {
  const parts = [
    `${statusLabel} - ${syncProgress.completedEntries} / ${syncProgress.totalEntries}`,
  ];
  if (storageStatus) {
    const storageLabel =
      storageStatus.storageLimitBytes > 0
        ? `${formatBytes(storageStatus.storageUsedBytes)} / ${formatBytes(storageStatus.storageLimitBytes)}`
        : formatBytes(storageStatus.storageUsedBytes);
    const percent =
      storageStatus.storageLimitBytes > 0
        ? ` (${Math.round((storageStatus.storageUsedBytes / storageStatus.storageLimitBytes) * 100)}%)`
        : "";
    parts.push(`Storage: ${storageLabel}${percent}`);
  }

  return parts.join(" - ");
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
