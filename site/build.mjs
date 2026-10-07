#!/usr/bin/env node
// subswap.tanookistudios.com - a small static site, built from this folder into site/dist.
//
//   node site/build.mjs                 build
//   node site/build.mjs --deploy        build, then deploy to the Cloudflare Pages project "subswap-site"
//
// Versions come from site/versions.json (newest first); each one's zip is a GitHub release asset on
// TanookiStudios/SubSwap, tag v<version>. Screenshots are the store screenshots (npm run screenshots),
// converted to webp in site/shots.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(here, "dist");
const SITE = "https://subswap.tanookistudios.com";
const REPO = "https://github.com/TanookiStudios/SubSwap";
const TIP = "https://tanookistudios.com/SupportMe";
const PRIVACY_CANONICAL = "https://tanookistudios.com/apps/subswap/privacy";
const INDEXNOW_KEY = "6c3d45f5ce86da7aee111992792affcb";
const VERSIONS = JSON.parse(fs.readFileSync(path.join(here, "versions.json"), "utf8"));
const LATEST = VERSIONS[0];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.version !== LATEST.version) throw new Error(`site/versions.json starts at ${LATEST.version} but manifest.json is ${manifest.version} - add the new version's notes first`);
const zipOf = (v) => `${REPO}/releases/download/v${v}/subswap-${v}.zip`;
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const SHOTS = [
  ["first", "SubSwap's main screen: step 1, save the subscriptions from your old account, and step 2, subscribe on your new account, with a practice-run option."],
  ["walkthrough", "The first-run walkthrough card: two accounts, one list. SubSwap saves the channels you follow on one account and subscribes to them on another, with no password and no account to make."],
  ["pick", "Step 2 with a saved list picked: My subscriptions, 15 channels, ready to subscribe on the new account."],
  ["running", "A run in progress: 130 of 196 channels done, each subscribed channel listed as it goes, and channels you already follow skipped."],
  ["break", "SubSwap taking a 47 second break partway through, because going slowly is what keeps your account safe."],
  ["done", "All done: 196 of 196 channels handled, 184 subscribed and 12 already followed, with an estimate of the time it saved."],
  ["about", "The About section, where Maddie explains why she built SubSwap and how she makes her living from small apps like it."],
];

const NAV = [["index.html", "Home"], ["how-it-works.html", "How It Works"], ["download.html", "Download"], ["privacy.html", "Privacy"], ["about-maddie.html", "About Maddie"]];
const href = (f) => (f === "index.html" ? "/" : `/${f.replace(".html", "")}`);
const SIG = fs.readFileSync(path.join(root, "assets", "signature.svg"), "utf8").replace(/<\?xml[^>]*>/, "").replace("<svg", '<svg role="img" aria-label="Signed, Maddie" class="sig"');

const CSS = `
:root{color-scheme:dark light;--bg:#111318;--card:#181b21;--line:#2a2e36;--ink:#f2f3f5;--muted:#a3a9b3;--pink:#f4b6cf;--pink-ink:#2a0f1c;--green:#4ade80;--focus:#93c5fd}
@media (prefers-color-scheme:light){:root{--bg:#fbf8f9;--card:#ffffff;--line:#ead9e0;--ink:#16181d;--muted:#5d6470;--pink:#e57fa8;--pink-ink:#1d0812;--green:#15803d;--focus:#1d4ed8}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit;text-decoration-color:var(--pink);text-underline-offset:3px}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:6px}
.skip{position:absolute;left:-999px;top:8px;background:var(--pink);color:var(--pink-ink);padding:8px 14px;border-radius:8px;z-index:9}.skip:focus{left:12px}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line)}header.top .wrap{display:flex;align-items:center;gap:18px;min-height:64px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:19px;text-decoration:none}.brand img{width:30px;height:30px;border-radius:8px}
nav.main{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}nav.main a{padding:7px 11px;border-radius:8px;text-decoration:none;color:var(--muted);font-size:15px}
nav.main a:hover{color:var(--ink)}nav.main a[aria-current=page]{color:var(--ink);background:var(--card)}
main{padding:56px 0 80px}
.eyebrow{margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--pink)}
h1{margin:0;font-size:clamp(32px,5.4vw,52px);line-height:1.06;letter-spacing:-.025em}
h2{margin:56px 0 14px;font-size:clamp(23px,3vw,30px);letter-spacing:-.015em;line-height:1.2}
h3{margin:0 0 6px;font-size:18px}
.lede{font-size:clamp(18px,2.2vw,21px);color:var(--muted);max-width:640px;margin:18px 0 0}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:700;text-decoration:none;border:1px solid var(--line);background:var(--card)}
.btn.pink{background:var(--pink);color:var(--pink-ink);border-color:transparent}
.small{font-size:14px;color:var(--muted)}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:44px;align-items:center}
@media (max-width:820px){.hero{grid-template-columns:1fr}}
.shot{width:100%;height:auto;border-radius:14px;border:1px solid var(--line);display:block;background:var(--card)}
.steps{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-top:8px}@media (max-width:720px){.steps{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.num{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--pink);color:var(--pink-ink);font-weight:800;margin-bottom:10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}@media (max-width:820px){.grid3{grid-template-columns:1fr}}
.gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}@media (max-width:720px){.gallery{grid-template-columns:1fr}}
figure{margin:0}figcaption{font-size:14px;color:var(--muted);margin-top:8px}
.prose{max-width:720px}.prose p,.prose li{color:var(--ink)}.prose .muted{color:var(--muted)}
ol.how{padding-left:22px}ol.how li{margin:8px 0}
code,kbd{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
details.faq{border-top:1px solid var(--line);padding:14px 0}details.faq summary{cursor:pointer;font-weight:700}details.faq p{color:var(--muted)}
.version{border-top:1px solid var(--line);padding:22px 0;display:grid;grid-template-columns:200px 1fr;gap:18px}@media (max-width:640px){.version{grid-template-columns:1fr}}
.version ul{margin:0;padding-left:20px}.badge{display:inline-block;font-size:12px;font-weight:700;color:var(--pink-ink);background:var(--pink);border-radius:999px;padding:2px 9px;margin-left:6px}
.note{border-left:3px solid var(--pink);padding:4px 0 4px 16px;color:var(--muted)}
.sig{width:190px;height:auto;color:var(--ink);margin-top:20px}
footer{border-top:1px solid var(--line);padding:28px 0 44px;color:var(--muted);font-size:14px}footer .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

function page({ file, title, desc, body, robots = "index, follow, max-image-preview:large", canonical, ld = [] }) {
  const url = canonical || `${SITE}${href(file)}`;
  const org = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "SubSwap", applicationCategory: "BrowserApplication", operatingSystem: "Chrome, Edge, Brave, Vivaldi, Opera (Chromium)", softwareVersion: LATEST.version, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, url: SITE, author: { "@type": "Person", name: "Maddie" }, publisher: { "@type": "Organization", name: "Tanooki Studios", url: "https://tanookistudios.com" } };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${robots === "noindex" ? "" : `<link rel="canonical" href="${url}">`}
<meta name="robots" content="${robots}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/shots/first.webp"><meta property="og:site_name" content="SubSwap">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${SITE}/shots/first.webp">
${[org, ...ld].map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip To Content</a>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><img src="/icon-512.png" alt="" width="30" height="30">SubSwap</a>
  <nav class="main" aria-label="Main">${NAV.map(([f, l]) => `<a href="${href(f)}"${f === file ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
</div></header>
<main id="main"><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">
  <span>SubSwap is free and open source (MIT). Made by Maddie at <a href="https://tanookistudios.com">Tanooki Studios</a>.</span>
  <span><a href="${REPO}">Source Code</a> · <a href="/privacy">Privacy</a> · <a href="${TIP}">Support My Work</a> · <a href="https://tanookistudios.com/contact">Contact</a></span>
</div></footer>
</body>
</html>
`;
}

const pages = {};
const shot = ([n, alt], eager = false) => `<img class="shot" src="/shots/${n}.webp" alt="${esc(alt)}" width="1280" height="800"${eager ? "" : ' loading="lazy"'}>`;

pages["index.html"] = page({
  file: "index.html",
  title: "SubSwap - Move Your YouTube Subscriptions to a New Account",
  desc: "Free browser extension that copies your YouTube subscriptions from one account to another - no password, no account, no server. Practice run, safe pacing, open source.",
  body: `
<section class="hero">
  <div>
    <p class="eyebrow">Free Browser Extension · v${LATEST.version}</p>
    <h1>Move your YouTube subscriptions to a new account.</h1>
    <p class="lede">Switching YouTube accounts means finding every channel you follow and pressing Subscribe on each one again. SubSwap does that part for you: save the list on the old account, then subscribe to all of it on the new one.</p>
    <div class="btns"><a class="btn pink" href="/download">Download SubSwap</a><a class="btn" href="/how-it-works">How It Works</a></div>
    <p class="small">Works in Chrome, Edge, Brave, Vivaldi and Opera. No account, no password, no server.</p>
  </div>
  ${shot(SHOTS[0], true)}
</section>

<h2>Two Steps, Two Sittings</h2>
<div class="steps">
  <div class="card"><span class="num">1</span><h3>Save From Your Old Account</h3><p>Signed into the account you're leaving, press <strong>Save my subscriptions</strong>. A YouTube window scrolls through your subscriptions for a few seconds and closes itself. Nothing on that account changes - it only reads.</p></div>
  <div class="card"><span class="num">2</span><h3>Subscribe On Your New Account</h3><p>Sign into the new account, pick the saved list and press go. SubSwap works through it one channel at a time, skipping anything you already follow, and you can watch every step as it happens.</p></div>
</div>

<h2>Built To Keep Your Account Safe</h2>
<div class="grid3">
  <div class="card"><h3>Practice Run First</h3><p>Tick <em>Practice run</em> and SubSwap goes through the entire list without subscribing to anything, so you can see it's right before it touches your account.</p></div>
  <div class="card"><h3>Slow On Purpose</h3><p>A gap between every channel and a longer break every twenty. Rushing is what gets accounts limited, so it doesn't.</p></div>
  <div class="card"><h3>Pick Up Where You Left Off</h3><p>Close the tab or restart the browser mid-run and nothing is lost. Come back and press Resume.</p></div>
  <div class="card"><h3>Nothing Leaves Your Browser</h3><p>No account, no server, no analytics, no YouTube API key. Your list lives in your own browser and nobody else can see it.</p></div>
  <div class="card"><h3>Got A Google Takeout File?</h3><p>Load your Takeout subscriptions CSV instead of scanning - same result, no scan needed.</p></div>
  <div class="card"><h3>Open Source</h3><p>Every line is <a href="${REPO}">on GitHub</a> under the MIT license, including the part that reads your subscriptions. You don't have to take anyone's word for what it does.</p></div>
</div>

<h2>See It Working</h2>
<div class="gallery">
${SHOTS.slice(1).map((s) => `  <figure>${shot(s)}<figcaption>${esc(s[1])}</figcaption></figure>`).join("\n")}
</div>

<h2>Free, And Staying Free</h2>
<p class="prose">There's no paid tier, no ads and nothing held back. SubSwap is made by <a href="/about-maddie">Maddie</a>, an autistic developer who builds small tools that fix one specific irritation properly. If it saved you an evening of clicking Subscribe, you can <a href="${TIP}">support her work</a>.</p>
<div class="btns"><a class="btn pink" href="/download">Download SubSwap ${LATEST.version}</a></div>
`,
});

pages["how-it-works.html"] = page({
  file: "how-it-works.html",
  title: "How SubSwap Works - Install and Move Your Subscriptions",
  desc: "Install SubSwap in Chrome, Edge or Brave, save your YouTube subscriptions from your old account, and subscribe to them on your new one. Step by step, with answers to common questions.",
  body: `
<div class="prose">
<p class="eyebrow">Guide</p>
<h1>How It Works</h1>
<p class="lede">Installing takes about a minute. Moving your subscriptions takes two short sittings - one on each account.</p>

<h2>Install It</h2>
<p>SubSwap isn't in the Chrome Web Store yet, so for now it installs the same way developers load extensions. It's quick:</p>
<ol class="how">
  <li><a href="/download">Download the latest zip</a> and unzip it. You'll get a folder called <code>subswap-${LATEST.version}</code> - keep it somewhere it won't get deleted, like your Documents folder.</li>
  <li>Open <code>chrome://extensions</code> in your browser (in Edge it's <code>edge://extensions</code>, in Brave <code>brave://extensions</code>).</li>
  <li>Turn on <strong>Developer mode</strong> - the switch is in the top corner.</li>
  <li>Press <strong>Load unpacked</strong> and pick the folder you unzipped.</li>
  <li>Click the SubSwap icon in your toolbar (it may be under the puzzle-piece menu - pin it while you're there). That opens SubSwap in its own tab, which is where everything happens.</li>
</ol>
<p class="note">The first time it opens, a four-card walkthrough explains the two steps. You can bring it back any time from Settings.</p>

<h2>Step 1 - Save From Your Old Account</h2>
<ol class="how">
  <li>Make sure this browser is signed into YouTube with the <strong>old</strong> account.</li>
  <li>Press <strong>Save my subscriptions</strong>.</li>
  <li>A YouTube window opens and scrolls itself through your subscriptions. Leave it be for a few seconds - it has to be on screen to read the list - and it closes itself when it's done.</li>
</ol>
<p>Nothing on your account is changed; this step only reads. Already have a Google Takeout export? Load its subscriptions CSV from Settings instead.</p>

<h2>Step 2 - Subscribe On Your New Account</h2>
<ol class="how">
  <li>Sign out of YouTube and sign in with the <strong>new</strong> account.</li>
  <li>Come back to the SubSwap tab and pick your saved list.</li>
  <li>Leave <strong>Practice run</strong> ticked the first time. It goes through the whole list and tells you exactly what it would do, without subscribing to anything.</li>
  <li>Happy with it? Untick Practice run and press <strong>Subscribe to them all</strong>.</li>
</ol>
<p>It works through the list one channel at a time, with a gap between each and a longer break every twenty. Channels you already follow are skipped. Keep the tab open while it works - and if you close it anyway, nothing is lost: come back and press Resume.</p>

<h2>Common Questions</h2>
<details class="faq"><summary>Does SubSwap need my password or a Google sign-in?</summary><p>No. It works with the YouTube page you're already signed into, in your own browser - the same as clicking yourself. It never sees your password or any access token, and it doesn't use the YouTube API.</p></details>
<details class="faq"><summary>My new account is in a different browser profile.</summary><p>Extension storage doesn't cross browser profiles. After step 1, use <strong>Save to a file</strong> next to your list, then load that file into SubSwap in the other profile.</p></details>
<details class="faq"><summary>Why does it go so slowly?</summary><p>Because subscribing to hundreds of channels in a few seconds looks like a bot, and that's how accounts get limited. The pauses are deliberate. A few hundred channels takes a while - you can leave it running.</p></details>
<details class="faq"><summary>Why does a YouTube window pop up?</summary><p>YouTube only loads more of your subscription list while the page is actually on screen, so the window has to be visible for the few seconds it spends reading. While it subscribes, the window stays minimized, and it pops back up only if something needs you.</p></details>
<details class="faq"><summary>Which browsers does it work in?</summary><p>Anything built on Chromium: Chrome, Edge, Brave, Vivaldi and Opera. It doesn't work in Firefox or Safari.</p></details>
<details class="faq"><summary>How do I update to a new version?</summary><p>Download the new zip from the <a href="/download">Download page</a>, unzip it over your old folder (or into a new one), then press the reload arrow on SubSwap's card in <code>chrome://extensions</code>. Your saved lists are kept.</p></details>
<details class="faq"><summary>How do I remove it?</summary><p>Press Remove on its card in <code>chrome://extensions</code>. Everything it stored lived in your browser, so removing it deletes all of it.</p></details>
</div>
`,
});

pages["download.html"] = page({
  file: "download.html",
  title: `Download SubSwap ${LATEST.version} - Free YouTube Subscription Mover`,
  desc: `Download SubSwap ${LATEST.version}, the free browser extension that moves your YouTube subscriptions to a new account. Every version and what changed.`,
  body: `
<p class="eyebrow">Download</p>
<h1>Download SubSwap</h1>
<p class="lede">Version ${LATEST.version}, released ${fmtDate(LATEST.date)}. Free, no account, works in any Chromium browser.</p>
<div class="btns"><a class="btn pink" href="${zipOf(LATEST.version)}">Download SubSwap ${LATEST.version} (.zip)</a><a class="btn" href="/how-it-works">How To Install It</a></div>
<p class="small">Unzip it, open <code>chrome://extensions</code>, turn on Developer mode and press Load unpacked. <a href="/how-it-works">Step-by-step instructions</a>. Chrome Web Store listing coming soon.</p>

<h2>What's New</h2>
${VERSIONS.map((v, i) => `<div class="version"><div><h3>Version ${v.version}${i === 0 ? '<span class="badge">Latest</span>' : ""}</h3><p class="small">${fmtDate(v.date)}<br><a href="${zipOf(v.version)}">Download ${v.version}</a></p></div><ul>${v.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`).join("\n")}

<h2>Prefer To Build It Yourself?</h2>
<p class="prose">There's no build step. Clone <a href="${REPO}">the repository</a> and load the folder with Load unpacked - it's exactly what's in the zip.</p>
`,
});

pages["privacy.html"] = page({
  file: "privacy.html",
  canonical: PRIVACY_CANONICAL,
  title: "SubSwap Privacy - What SubSwap Knows About You",
  desc: "SubSwap stores your saved channel list in your own browser and sends nothing anywhere. No account, no server, no analytics, no YouTube API.",
  body: `
<div class="prose">
<p class="eyebrow">Privacy</p>
<h1>What SubSwap Knows About You</h1>
<p class="lede">Nothing. There is no account and no server for it to tell.</p>
<p class="small">Last updated October 6, 2026. The official copy of this policy lives at <a href="${PRIVACY_CANONICAL}">tanookistudios.com/apps/subswap/privacy</a>.</p>
<h2>What It Stores</h2>
<p>Two things, both in your own browser's extension storage:</p>
<ul><li>The list of YouTube channels you chose to save - the channel's name, its ID, its address and its picture.</li><li>How far a run has got, so that closing the browser in the middle of one does not lose your place.</li></ul>
<p>No email address, no name, no identifiers, no browsing history, no watch history.</p>
<h2>Where It Goes</h2>
<p>Nowhere. SubSwap has no backend, makes no network requests of its own, and has no analytics. Everything it works out stays on your machine, and nobody can see it. The one exception is the tip jar, and nothing happens there unless you press the button yourself.</p>
<h2>What It Can See, And When</h2>
<p>SubSwap can read pages on <strong>youtube.com</strong> and nowhere else. It reads your subscriptions page when you ask it to save your list, and a channel's page to check whether you already follow it. It does nothing at all until you press a button.</p>
<h2>No Google Account Access</h2>
<p>SubSwap does not use the YouTube Data API, does not ask you to sign in, and never sees your Google password or any access token.</p>
<h2>The Tip Jar</h2>
<p>Optional, and nothing is locked behind it. If you press <em>Chip In</em>, the amount you picked goes to tanookistudios.com, which hands you to Stripe for the payment. Card details go to Stripe and are covered by <a href="https://stripe.com/privacy">Stripe's privacy policy</a>.</p>
<h2>When You Uninstall It</h2>
<p>Removing SubSwap deletes everything it stored. Your browser then opens one page with an optional, anonymous form asking what went wrong. Only the version number is carried to it; close the tab and nothing is sent.</p>
<h2>Third Parties</h2>
<p>Stripe, and only if you choose to leave a tip. Nothing is sold, shared or used for advertising, because nothing is collected in the first place.</p>
<h2>Questions</h2>
<p>Use the <a href="https://tanookistudios.com/contact">contact page</a>.</p>
</div>
`,
});

pages["about-maddie.html"] = page({
  file: "about-maddie.html",
  title: "About Maddie - SubSwap",
  desc: "Maddie is an autistic developer who makes small tools that fix one specific irritation properly, plus apps for PC, Mac, phones and tablets.",
  body: `
<div class="prose">
<p class="eyebrow">The Person Behind It</p>
<h1>About Maddie</h1>
<p>I built this because I was moving to a new YouTube account and realized the alternative was clicking Subscribe about five hundred times. I got roughly forty in before deciding there's gotta be a better way. I present to you, my better way.</p>
<p>I'm Maddie, I'm autistic, and I often make small tools that fix one specific irritation properly — the sort of thing that's too small for a company to bother with and too annoying to keep putting up with.</p>
<p>I also develop apps for PC, Mac, mobiles, and tablets. I generally develop apps that:</p>
<ol class="how"><li>Help me with a problem that I have.</li><li>Will help others.</li><li>Bring a little bit of good to the world.</li></ol>
<p>This is also my income. Due to my autism, I don't do well with most typical office jobs. In fact, I tend to really struggle. So with the support of my wife, I decided to invest in myself, and create my own apps full-time.</p>
<p>See everything else I make at <a href="https://tanookistudios.com">Tanooki Studios</a>, or <a href="${TIP}">support my work</a>.</p>
${SIG}
</div>
`,
});

// ---- write
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "shots"), { recursive: true });
for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(out, f), html);
fs.writeFileSync(path.join(out, "404.html"), page({ file: "404.html", robots: "noindex", title: "Page Not Found - SubSwap", desc: "That page isn't here.", body: `<p class="eyebrow">404</p><h1>Page Not Found.</h1><p class="lede">That page isn't here.</p><div class="btns"><a class="btn pink" href="/">Home</a><a class="btn" href="/download">Download SubSwap</a></div>` }));
for (const f of ["icon-512.png", "apple-touch-icon.png", "favicon-32.png"]) fs.copyFileSync(path.join(here, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(here, "shots"))) fs.copyFileSync(path.join(here, "shots", f), path.join(out, "shots", f));
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(pages).filter((f) => f !== "privacy.html").map((f) => `  <url><loc>${SITE}${href(f)}</loc><lastmod>${f === "download.html" ? LATEST.date : today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
fs.writeFileSync(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(out, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
fs.writeFileSync(path.join(out, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/shots/*\n  Cache-Control: public, max-age=604800\n");
console.log(`built ${Object.keys(pages).length} pages + 404 for SubSwap ${LATEST.version} -> ${out}`);

if (process.argv.includes("--deploy")) execFileSync("npx", ["--yes", "wrangler", "pages", "deploy", out, "--project-name", "subswap-site", "--commit-dirty=true"], { stdio: "inherit", cwd: here }); // cwd: site/, so site/functions deploys too
