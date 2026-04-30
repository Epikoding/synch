import { getDefaultApiBaseUrl, normalizeApiBaseUrl } from "../config";
import {
  DEFAULT_SYNC_FILE_RULES,
  normalizeSyncFileRules,
  type SyncFileRules,
} from "../sync/core/file-rules";

export const SYNCH_SETTINGS_KEY = "settings";

export interface SynchPluginSettings {
  apiBaseUrl: string;
  fileRules: SyncFileRules;
}

export const DEFAULT_SYNCH_PLUGIN_SETTINGS: SynchPluginSettings = {
  apiBaseUrl: getDefaultApiBaseUrl(),
  fileRules: DEFAULT_SYNC_FILE_RULES,
};

export function normalizeSynchPluginSettings(
  value: unknown,
  defaultApiBaseUrl = getDefaultApiBaseUrl(),
): SynchPluginSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      apiBaseUrl: defaultApiBaseUrl,
      fileRules: DEFAULT_SYNC_FILE_RULES,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    apiBaseUrl: normalizeApiBaseUrl(record.apiBaseUrl, defaultApiBaseUrl),
    fileRules: normalizeSyncFileRules(record.fileRules),
  };
}
