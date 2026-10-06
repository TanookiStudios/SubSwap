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

  // The Web Store requires a 128px icon, and the toolbar wants the rest.
  for (const size of ["16", "32", "48", "128"]) {
    for (const [where, block] of [
      ["icons", manifest.icons],
      ["action.default_icon", manifest.action?.default_icon],
    ]) {
      const path = block?.[size];
      if (!path) fail(`manifest.json ${where} is missing the ${size}px entry`);
      else if (!exists(join(root, path))) fail(`${where}["${size}"] points at a missing file: ${path}`);
    }
  }
}

// --- html references -------------------------------------------------------

const html = readFileSync(join(root, "src/manager.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = match[1];
  if (/^(https?:)?\/\//.test(target)) continue;
  // Fragments, mailto: and data: aren't files on disk.
  if (/^(#|mailto:|data:|tel:)/.test(target)) continue;
  if (!exists(join(root, "src", target))) fail(`manager.html references a missing file: ${target}`);
}
if (!html.includes('type="module"')) fail("manager.html must load manager.js as a module");

// --- the [hidden] trap -----------------------------------------------------
//
// The browser's own `[hidden] { display: none }` loses to any author rule that
// sets display, so `.step { display: flex }` silently beat it and elements the
// JS "hid" stayed on screen. Shipped that once; not again.

const css = readFileSync(join(root, "src/manager.css"), "utf8");
const managerJs = readFileSync(join(root, "src/manager.js"), "utf8");

if (/\.hidden\s*=/.test(managerJs)) {
  const guard = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css);
  if (!guard) {
    fail(
      "manager.js sets .hidden on elements, but manager.css has no " +
        "`[hidden] { display: none !important }` — any rule setting display will beat the " +
        "browser default and nothing will actually hide",
    );
  }
}

// --- tabs and cloned templates ---------------------------------------------
//
// The signature and the tip form each live once as a <template> and are cloned
// into every [data-mount] slot. Both halves of that are silent when they break:
// a slot naming a template that isn't there throws at boot and the page comes
// up blank, and an id inside a template becomes a duplicate id the moment it is
// mounted twice, at which point getElementById starts answering with whichever
// copy happens to be first.

const templateIds = [...html.matchAll(/<template id="([^"]+)"/g)].map((m) => m[1]);

for (const match of html.matchAll(/data-mount="([^"]+)"/g)) {
  if (!templateIds.includes(`tpl-${match[1]}`)) {
    fail(`manager.html has data-mount="${match[1]}" but no <template id="tpl-${match[1]}"> to clone`);
  }
}

for (const match of html.matchAll(/<template id="[^"]+">([\s\S]*?)<\/template>/g)) {
  for (const dupe of match[1].matchAll(/\sid="([^"]+)"/g)) {
    fail(`manager.html: a template carries id="${dupe[1]}" — cloned into two slots that becomes a duplicate id`);
  }
}

// Every tab and every in-page jump has to land on a view that exists.
const viewIds = [...html.matchAll(/<section class="view" id="([^"]+)"/g)].map((m) => m[1]);

for (const match of html.matchAll(/data-view="([^"]+)"/g)) {
  if (!viewIds.includes(`view-${match[1]}`)) {
    fail(`manager.html has data-view="${match[1]}" but no <section class="view" id="view-${match[1]}">`);
  }
}
for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) {
  if (!viewIds.includes(match[1])) fail(`manager.html: a tab points at aria-controls="${match[1]}", which isn't a view`);
}

// A tab carries the same answer twice: aria-controls for assistive tech, and
// data-view for the click handler, which is the one that actually does
// anything. Shipped a nav once where only the first was there — it looked
// perfect and no tab did a thing. Both, agreeing, or it isn't a tab.
const nav = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/);
if (!nav) fail("manager.html has no <nav class=\"tabs\"> — the three views are unreachable");
else {
  for (const tab of nav[0].matchAll(/<button[^>]*>/g)) {
    const view = tab[0].match(/data-view="([^"]+)"/);
    const controls = tab[0].match(/aria-controls="([^"]+)"/);
    if (!view) fail(`a tab has no data-view, so clicking it does nothing: ${tab[0].trim()}`);
    else if (!controls) fail(`the "${view[1]}" tab has no aria-controls`);
    else if (controls[1] !== `view-${view[1]}`) {
      fail(`the "${view[1]}" tab says data-view="${view[1]}" but aria-controls="${controls[1]}" — they disagree`);
    }
  }
}

// --- the tip form still posts where the money is ---------------------------
//
// It's a plain form, which is the whole reason it can live in here at all — no
// remote script, no extra host permission. The flip side is that nothing fails
// loudly if the endpoint is mistyped: the browser opens a new tab, gets a 404,
// and the donation quietly doesn't happen.

const DONATE_ENDPOINT = "https://tanookistudios.com/api/donate";

const tipForm = html.match(/<form[\s\S]*?<\/form>/);
if (!tipForm) {
  fail("manager.html has no tip form — the Support My Work tab needs it");
} else {
  const form = tipForm[0];
  if (!form.includes(`action="${DONATE_ENDPOINT}"`)) {
    fail(`the tip form must post to ${DONATE_ENDPOINT} — anything else is a silent 404 in a new tab`);
  }
  if (!/method="post"/.test(form)) fail("the tip form must be method=post; the endpoint refuses anything else");
  if (!/target="_blank"/.test(form)) fail("the tip form needs target=_blank, or checkout replaces the manager tab mid-run");
  for (const field of ["site", "amount", "interval"]) {
    if (!new RegExp(`name="${field}"`).test(form)) fail(`the tip form is missing its "${field}" field`);
  }
}

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
