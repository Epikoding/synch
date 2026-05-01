import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const nextReleaseNotesPath = path.join(pluginRoot, "release-notes", "next.md");

const template = `# Next Obsidian plugin release

## Added

## Changed

## Fixed
`;

await fs.writeFile(nextReleaseNotesPath, template);
console.log(nextReleaseNotesPath);
