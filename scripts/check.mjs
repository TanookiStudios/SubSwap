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

// Every data-open has to name a <details> that's actually on the page. The run
// finishing calls this by name too, which is how an ask nobody sees happens.
const folds = [...html.matchAll(/<details[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

for (const match of html.matchAll(/data-open="([^"]+)"/g)) {
  if (!folds.includes(match[1])) fail(`manager.html has data-open="${match[1]}", which isn't a <details> on the page`);
}
for (const match of managerJs.matchAll(/openFold\(\s*"([^"]+)"/g)) {
  if (!folds.includes(match[1])) fail(`manager.js calls openFold("${match[1]}"), which isn't a <details> on the page`);
}
if (!folds.includes("fold-support")) {
  fail("there's no #fold-support — finishing a run is supposed to open the tip jar, and it can't");
}

// --- every el("id") the JS reaches for actually exists ---------------------
//
// el() is getElementById, so a stale id is `null`, and `null.prepend` throws
// halfway through a render. Renaming a section and missing one reference is a
// one-character mistake that only shows up in whichever UI state happens to
// touch that branch — which is how a crash on the very first run, before
// anything is saved, got all the way to a build.

const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

for (const match of managerJs.matchAll(/\bel\("([^"]+)"\)/g)) {
  if (!markupIds.has(match[1])) {
    fail(`manager.js calls el("${match[1]}"), but nothing in manager.html has that id`);
  }
}

// --- the walkthrough's steps are reachable ---------------------------------
//
// manager.js counts .walk-step elements and pages through them by data-step,
// so a gap or a repeat leaves a step nobody can ever get to, and the counter
// says "4" while only three exist.

const steps = [...html.matchAll(/class="walk-step" data-step="(\d+)"/g)].map((m) => Number(m[1]));
if (steps.length === 0) fail("manager.html has no .walk-step sections — the walkthrough is empty");
const wanted = steps.map((_, i) => i + 1).join(",");
if (steps.join(",") !== wanted) {
  fail(`the walkthrough's data-step values are ${steps.join(",")}; they have to be ${wanted} or a step is unreachable`);
}

// --- the uninstall poll points somewhere real ------------------------------
//
// Chrome opens this after the extension is gone, so nothing is left running to
// notice it 404ing. A typo here is silent for everyone forever.

const background = readFileSync(join(root, "src/background.js"), "utf8");
const FAREWELL = "https://tanookistudios.com/apps/subswap/goodbye";

if (!background.includes("setUninstallURL")) {
  fail("src/background.js doesn't call setUninstallURL — nobody is ever asked why they left");
} else if (!background.includes(`"${FAREWELL}"`)) {
  fail(`the uninstall URL has to be ${FAREWELL} — anything else is a 404 nobody will ever see`);
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
