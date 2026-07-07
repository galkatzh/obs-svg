/**
 * Runs from the `npm version` hook: syncs the new package.json version into
 * manifest.json and records it in versions.json against the manifest's
 * minAppVersion. Usage: `npm version patch|minor|major`.
 */

import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
    console.error("Run via `npm version` so npm_package_version is set.");
    process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 4) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 4) + "\n");
