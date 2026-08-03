// Builds the zip you upload to the Chrome Web Store.
//
//   npm run package   ->  dist/subswap-<version>.zip
//
// Two rules this exists to enforce, both of which are common first rejections:
//
//   1. manifest.json must be at the ROOT of the zip. Zipping the enclosing
//      folder puts it one level down and the upload is refused.
//   2. Nothing that isn't the extension goes in — no tests, no scripts, no
//      package.json, no README, no source SVGs.
//
// It runs the full check first, so a broken build can't be packaged.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Everything the extension actually needs at runtime, and nothing else.
const SHIP = ["manifest.json", "src"];

// Belt and braces: even inside src/, these never ship.
const EXCLUDE = ["*/.DS_Store", ".DS_Store"];

console.log("running checks first…");
execFileSync(process.execPath, [join(root, "scripts/check.mjs")], { cwd: root, stdio: "inherit" });

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const outDir = join(root, "dist");
const zipPath = join(outDir, `subswap-${manifest.version}.zip`);

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

for (const entry of SHIP) {
  if (!existsSync(join(root, entry))) throw new Error(`missing ${entry} — nothing to package`);
}

// -r recurse, -X drop the Finder metadata that bloats macOS zips.
execFileSync("zip", ["-r", "-X", "-q", zipPath, ...SHIP, "-x", ...EXCLUDE], { cwd: root });

// Read the zip back and prove the two rules hold.
const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const problems = [];
if (!listing.includes("manifest.json")) {
  problems.push("manifest.json is not at the root of the zip — the store will reject it");
}
for (const unwanted of ["package.json", "README.md", "test/", "scripts/", "node_modules/", ".git/"]) {
  if (listing.some((entry) => entry.startsWith(unwanted))) problems.push(`${unwanted} ended up in the zip`);
}
for (const size of ["16", "32", "48", "128"]) {
  if (!listing.includes(`src/icons/icon-${size}.png`)) problems.push(`icon-${size}.png is missing from the zip`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) with the package:\n`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

const sizeKb = (execFileSync("wc", ["-c", zipPath], { encoding: "utf8" }).trim().split(/\s+/)[0] / 1024).toFixed(1);
console.log(`\n${listing.length} files, ${sizeKb} KB`);
console.log(`ready to upload: dist/subswap-${manifest.version}.zip`);
