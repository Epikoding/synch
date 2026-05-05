import { beforeEach, describe, expect, it } from "vitest";
import { resetObsidianMocks, setLanguage } from "obsidian";

import { getSynchLocale, t } from "./i18n";

describe("Synch i18n", () => {
  beforeEach(() => {
    resetObsidianMocks();
  });

  it("defaults unsupported languages to English", () => {
    setLanguage("fr");

    expect(getSynchLocale()).toBe("en");
    expect(t("sync.label")).toBe("Sync");
  });

  it("uses Korean for ko language codes", () => {
    setLanguage("ko-KR");

    expect(getSynchLocale()).toBe("ko");
    expect(t("sync.label")).toBe("동기화");
  });
});
