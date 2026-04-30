import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bump = process.argv[2];
const validBumps = new Set(["major", "minor", "patch"]);

if (!validBumps.has(bump)) {
  throw new Error("Usage: node scripts/bump-release-version.mjs <major|minor|patch>");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

const manifestPath = path.join(pluginRoot, "manifest.json");
const packagePath = path.join(pluginRoot, "package.json");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
const nextVersion = bumpVersion(manifest.version, bump);

manifest.version = nextVersion;
packageJson.version = nextVersion;

await Promise.all([writeJson(manifestPath, manifest), writeJson(packagePath, packageJson)]);

console.log(nextVersion);

function bumpVersion(version, bumpType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version "${version}". Expected x.y.z.`);
  }

  const [, major, minor, patch] = match.map(Number);

  if (bumpType === "major") {
    return `${major + 1}.0.0`;
  }

  if (bumpType === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
