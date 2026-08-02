# SubSwap

Take your YouTube subscriptions from one account to another without hunting down
every channel by hand.

Two steps:

1. **Export** — signed into the old account, scan and save the list.
2. **Subscribe** — signed into the new account, work through that list. Anything
   you already follow is skipped.

Works in Chrome, Brave, Edge, Vivaldi, Opera — anything Chromium. No account, no
server, no API key. Nothing leaves your browser.

## Installing

There's no build step. Clone it and load the folder:

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Click the SubSwap icon in the toolbar. That opens the manager tab, which is
   where everything happens.

## Using it

**Export.** Sign into the old account, give the list a name, hit *Scan this
account*. A YouTube window opens and scrolls itself through your subscriptions —
leave it be for a few seconds. The list is saved in the extension, and there's a
*Download* button if you want it as a file (you'll need that if the new account
lives in a different browser profile, since extension storage doesn't cross
profiles).

Already have a Google Takeout export? Load the CSV instead — same thing, no scan
needed.

The YouTube window it uses stays minimised while it subscribes, so it isn't
sitting there inviting you to click it. It has to be on screen for the few
seconds it spends *reading* your list, though — a minimised window stops
painting, and YouTube only loads the next batch of channels while the page is
actually rendering. It closes itself when the run finishes, and pops back up if
something needs your attention.

**Subscribe.** Sign into the new account, pick the list, choose a mode:

- **Auto** — SubSwap clicks Subscribe for you, with a random gap between each
  and a longer break every twenty.
- **Assist** — SubSwap opens each channel and puts a ring round the Subscribe
  button; you click it. It notices and moves on by itself. There's a *Skip* and
  a *Stop* in the banner at the bottom of the page.

Leave **Dry run** ticked for the first go. It walks the whole list and tells you
what it *would* do without clicking anything — that's how you find out the list
is right before it touches your account.

Keep the manager tab open while a run is going. If you close it, or the browser
restarts, the queue is saved — reopen SubSwap and hit **Resume**.

## Things worth knowing

- **Automating YouTube is against their terms of service.** In practice the
  realistic downside is a temporary "try again later" on subscribing, not a ban,
  and SubSwap stops and waits rather than pushing through it. Assist mode avoids
  the issue entirely — every click is genuinely yours.
- **YouTube rate-limits subscribing.** If three in a row don't take, the run
  pauses itself and says so. Leave it a few hours and resume. Nothing is lost.
- **YouTube caps accounts at 2,000 subscriptions.**
- If a channel has been deleted or renamed, it's marked failed with a reason
  rather than quietly counted as done. Failures get a *Retry* button.

## Development

```bash
npm run verify
```

That runs the static checks (`scripts/check.mjs` — parses every file, validates
the manifest, confirms the icons exist, confirms the injected scripts are
self-contained) and the unit tests (`node --test`) over the pure logic in
`src/lib`.

| Command | What it does |
| --- | --- |
| `npm run verify` | Checks and tests. Run this before anything else |
| `npm run icons` | Redraws `src/icons/*.png` from `assets/icon.svg` |
| `npm run screenshots` | Captures store screenshots, headless, from fabricated data |
| `npm run package` | Builds `dist/subswap-<version>.zip` for the Web Store |

`npm run package` runs the checks first and then reads its own zip back to
confirm `manifest.json` landed at the root and that no tests, scripts or
READMEs got swept in — the two things the store rejects uploads for.

## Releasing

`store/listing.md` has the summary, description, permission justifications and
privacy answers drafted, plus the pre-submit checklist.
`store/privacy-policy.html` is ready to host — the store requires a public URL
for it.

Layout:

| Path | What it is |
| --- | --- |
| `src/background.js` | Opens the manager tab; acts as a timer service for it |
| `src/manager.*` | The UI and the run loop |
| `src/lib/` | Pure logic — matching, diffing, the queue, CSV parsing |
| `src/inject/` | The bits that run inside YouTube |

Two design decisions that aren't obvious:

**The run loop lives in the manager page, not the service worker.** MV3 workers
get shut down after ~30 seconds idle, which would kill a long run halfway. A
normal extension tab doesn't. The worker only opens that tab and hands out
timers — Chrome throttles `setTimeout` in hidden tabs, and during a run the
manager is usually behind the YouTube window, so the waiting is delegated to the
worker where it isn't throttled.

**Injected scripts run in the MAIN world.** YouTube is Polymer: whether you're
subscribed lives in a JS property on the element (`.data.subscribed`), which an
isolated content script can't see. Reading it there makes the check
language-independent — matching the word "Subscribe" would break on any other
locale. There are fallbacks (the notification bell only exists when you're
subscribed, then `aria-label`), and if none of them work the channel is reported
as failed rather than guessed at.
