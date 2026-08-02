// Static checks that don't need a browser:
//
//  * every .js file parses
//  * the manifest has what Chrome needs, and every file it points at exists
//  * manager.html's script/style references exist, and so do every import
//  * the injected scripts are genuinely self-contained
//
// That last one earns its keep. Functions passed to chrome.scripting are
// stringified before injection, so an import or a module-level constant used
// inside one compiles fine, passes review, and then throws ReferenceError only
// once it's running inside YouTube where nobody can see it.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const jsFiles = files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
const exists = (p) => files.includes(resolve(p));

// --- every JS file parses --------------------------------------------------

for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    fail(`syntax error in ${relative(root, file)}\n${err.stderr?.toString().trim()}`);
  }
}

// --- manifest --------------------------------------------------------------

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
} catch (err) {
  fail(`manifest.json doesn't parse: ${err.message}`);
}

if (manifest) {
  for (const key of ["manifest_version", "name", "version", "permissions", "host_permissions", "background", "action"]) {
    if (manifest[key] === undefined) fail(`manifest.json is missing "${key}"`);
  }
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");

  for (const permission of ["storage", "scripting", "tabs"]) {
    if (!manifest.permissions?.includes(permission)) {
      fail(`manifest.json needs the "${permission}" permission`);
    }
  }

  // Anything Chrome-only would break Brave and the rest, which is the point of
  // the whole design.
  const banned = ["sidePanel", "identity", "declarativeNetRequest"];
  for (const permission of manifest.permissions || []) {
    if (banned.includes(permission)) {
      fail(`"${permission}" isn't reliably available across Chromium browsers — don't use it`);
    }
  }

  const worker = manifest.background?.service_worker;
  if (!worker) fail("manifest.json has no background.service_worker");
  else if (!exists(join(root, worker))) fail(`background.service_worker points at a missing file: ${worker}`);
}

// --- html references -------------------------------------------------------

const html = readFileSync(join(root, "src/manager.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = match[1];
  if (/^(https?:)?\/\//.test(target)) continue;
  if (!exists(join(root, "src", target))) fail(`manager.html references a missing file: ${target}`);
}
if (!html.includes('type="module"')) fail("manager.html must load manager.js as a module");

// --- imports resolve -------------------------------------------------------

for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/^import[^"']*["'](\.[^"']+)["']/gm)) {
    const target = resolve(dirname(file), match[1]);
    if (!exists(target)) {
      fail(`${relative(root, file)} imports something that doesn't exist: ${match[1]}`);
    }
  }
}

// --- injected scripts are self-contained -----------------------------------

for (const file of walk(join(root, "src/inject"))) {
  const source = readFileSync(file, "utf8");
  const name = relative(root, file);

  if (/^\s*import\s/m.test(source)) {
    fail(`${name} has an import — injected functions are stringified, so it would be undefined at runtime`);
  }

  // Top-level code, other than the exported functions themselves, would be
  // invisible to the injected copy for exactly the same reason.
  const topLevel = source
    .split("\n")
    .filter((line) => /^[a-zA-Z]/.test(line))
    .filter((line) => !/^export (async )?function /.test(line));
  if (topLevel.length > 0) {
    fail(`${name} declares things at module scope that the injected copy can't see:\n  ${topLevel.join("\n  ")}`);
  }
}

// --- report ----------------------------------------------------------------

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const problem of problems) console.error(` - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`checked ${jsFiles.length} js files, the manifest, and the injected scripts — all good`);
