import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(pluginRoot, "../..");
const releaseDir = path.join(pluginRoot, "dist");

const manifestPath = path.join(pluginRoot, "manifest.json");
const versionsPath = path.join(pluginRoot, "versions.json");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const versions = JSON.parse(await fs.readFile(versionsPath, "utf8"));

if (!manifest.version || !manifest.minAppVersion) {
  throw new Error("manifest.json must contain version and minAppVersion.");
}

versions[manifest.version] = manifest.minAppVersion;

await fs.mkdir(releaseDir, { recursive: true });
await Promise.all([
  writeJson(versionsPath, versions),
  writeJson(path.join(repoRoot, "manifest.json"), manifest),
  writeJson(path.join(repoRoot, "versions.json"), versions),
  writeJson(path.join(releaseDir, "manifest.json"), manifest),
  writeJson(path.join(releaseDir, "versions.json"), versions),
  fs.copyFile(path.join(pluginRoot, "styles.css"), path.join(releaseDir, "styles.css")),
]);

console.log(
  `[synch] synced Obsidian metadata for ${manifest.id} ${manifest.version} ` +
    `(minAppVersion ${manifest.minAppVersion})`,
);

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
