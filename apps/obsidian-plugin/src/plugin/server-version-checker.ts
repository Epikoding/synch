import {
  defaultHttpClient,
  stripTrailingSlash,
  type HttpClient,
} from "../http/request";

export type ServerPluginVersionStatus =
  | {
      status: "ok";
      minVersion: string;
    }
  | {
      status: "update_required";
      minVersion: string;
      message: string;
    };

export class SynchServerPluginVersionChecker {
  constructor(private readonly httpClient: HttpClient = defaultHttpClient) {}

  async check(apiBaseUrl: string, currentVersion: string): Promise<ServerPluginVersionStatus> {
    const response = await this.httpClient.request({
      url: `${stripTrailingSlash(apiBaseUrl)}/v1/obsidian-plugin/version-check?version=${encodeURIComponent(currentVersion)}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Server plugin version check failed with status ${response.status}.`);
    }

    const body = response.json;
    if (!isServerPluginVersionStatus(body)) {
      throw new Error("Server plugin version check returned an invalid response.");
    }

    return body;
  }
}

function isServerPluginVersionStatus(value: unknown): value is ServerPluginVersionStatus {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.status !== "string" ||
    typeof record.minVersion !== "string"
  ) {
    return false;
  }

  if (record.status === "ok") {
    return true;
  }

  return record.status === "update_required" && typeof record.message === "string";
}
