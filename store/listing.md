# Chrome Web Store listing — SubSwap

Everything the dashboard asks for, drafted. Edit freely; the wording is
deliberately plain and avoids the words that get this category of extension
rejected ("bot", "bulk", "mass", "auto-subscribe", "automation").

---

## Decision to make before you submit

**Which mode ships as the default?** Right now it's Auto — SubSwap does the
clicking. Assist mode (you click, it navigates and highlights) is materially
easier to defend to a reviewer, because the extension never interacts with
YouTube on your behalf.

Changing it is one line in `src/lib/queue.js` — `createQueue` defaults
`mode` to `"auto"`. I left it alone because it's a product decision, not a
technical one, and you weren't there to ask.

---

## Basics

**Name**

```
SubSwap
```

**Summary** (132 characters max — this one is 108)

```
Moving to a new YouTube account? Bring your subscriptions with you instead of finding every channel by hand.
```

**Category:** Productivity
**Language:** English

---

## Description

```
Changing YouTube accounts shouldn't mean losing everything you follow.

SubSwap saves the list of channels you're subscribed to on one account, then
helps you subscribe to them again on another — skipping anything you already
follow, so nothing gets done twice.

HOW IT WORKS

1. Signed into your old account, press "Save my subscriptions". SubSwap reads
   your subscriptions page. Nothing on your account is changed.
2. Sign into your new account and press go. SubSwap works through the list one
   channel at a time, showing you exactly what it's doing.

Already exported your data with Google Takeout? Load that CSV instead and skip
step one entirely.

A short walkthrough explains all of this the first time you open it, and lives
in Settings afterwards if you want it again.

TWO WAYS TO WORK

Assist mode opens each channel and highlights the Subscribe button for you to
click. Nothing is clicked for you.

Auto mode does the clicking, slowly and with pauses, and stops on its own if
YouTube starts rate-limiting.

BUILT TO BE UNHURRIED

There's a deliberate gap between each channel and a longer break every twenty,
because rushing is what gets accounts limited. If something does go wrong, the
run pauses itself and tells you — and your place in the list is saved, so you
can close the browser and pick up later exactly where you left off.

Practice run mode walks the entire list and reports what it would do without
touching anything, so you can check it found the right channels first.

PRIVATE BY DESIGN

There is no account, no server and no analytics. Your list of channels is
stored in your own browser and never sent anywhere. There's nothing to sign up
for. Delete the extension and it's gone.

Free, and always will be. There's a tip jar if you'd like to chip in, but
nothing is locked behind it and nothing changes either way.
```

---

## Permission justifications

The dashboard asks for one of these per permission. Weak answers here are a
common rejection, so they're written to be specific about *what* and *why*.

**`storage`**

```
Stores the user's saved list of channels and the progress of an in-progress
run, so a long run can be paused and resumed and is not lost if the browser is
closed. All of it stays in local browser storage.
```

**`tabs`**

```
SubSwap opens a single YouTube tab to work in and needs to know when that tab
has finished loading before it reads the page, and when the user has closed it
so the run can pause instead of failing silently.
```

**`scripting`**

```
Reads the user's subscriptions page to build the list, and reads each channel
page to determine whether the user is already subscribed before doing anything.
In Assist mode it also highlights the Subscribe button so the user can click it
themselves.
```

**Host permission — `https://www.youtube.com/*`**

```
YouTube is the only site this extension works with, and the only site it
requests access to. It needs to read the signed-in user's own subscriptions
page and individual channel pages to see subscription state. No other domain is
requested and no data leaves the browser.
```

**Single purpose** (they ask you to state it in one sentence)

```
Helping a user move their own YouTube subscriptions from one of their accounts
to another.
```

---

## Privacy practices

**Does this item collect user data?** Yes — it has to be declared, because the
list of channels a person follows is personal data, even though it never leaves
their machine.

Tick only:

- **Personally identifiable information** — no
- **Health / financial / authentication / personal communications / location** — no
- **Web history** — no
- **User activity** — no
- **Website content** — **yes**. The list of channels the user is subscribed to
  is read from the page.

Then certify:

- Not being sold to third parties — **true**
- Not being used or transferred for any purpose unrelated to the item's core
  functionality — **true**
- Not being used or transferred to determine creditworthiness or for lending — **true**

**About the tip jar.** The Support My Work section has a donation form that posts to
tanookistudios.com and hands off to Stripe Checkout in a new tab. It carries the
amount and nothing else — no channels, no identifiers, nothing about the user —
so it changes none of the answers above. Worth knowing when you fill the form in:

- It is a *donation*, not a purchase, and nothing in the extension is locked
  behind it. That's what keeps it clear of the Chrome Web Store payments policy,
  which covers digital goods and services consumed inside an extension.
- It opens no tabs by itself. The section unfolds in place when a job finishes;
  the only navigation is the one the user starts by pressing Chip In.
- It loads no third-party script. The form is plain HTML in the extension and
  the payment page is a normal tab on Stripe's own site.
- The hosted privacy policy describes all of this under "The Tip Jar".

If a reviewer does query it, the honest answer is the three lines above. The
fallback, if they insist, is to delete the form and leave the website link that
sits next to it — one block of markup, no other change.

**About the uninstall page.** `chrome.runtime.setUninstallURL` points at
tanookistudios.com/apps/subswap/goodbye, so removing the extension opens one tab
with an anonymous "what went wrong" form. Chrome does the opening, after the
extension is gone. Only the version number is carried across; there is no email,
name or identifier on the form or in the table behind it. It's described in the
hosted privacy policy under "When You Uninstall It" — reviewers do look for that
when an uninstall URL is set, and an undisclosed one is a rejection.

**Privacy policy URL:** LIVE at `https://tanookistudios.com/apps/subswap/privacy`
(unlinked from the site, kept out of the sitemap). The copy in
`store/privacy-policy.html` is the standalone original; the hosted page is the
one that counts.

---

## Before you press submit

- [ ] `npm run package` and upload `dist/subswap-1.0.0.zip`
- [ ] Decide Auto vs Assist as the shipped default (top of this file)
- [x] `SUPPORT_URL` set to https://madilynthomas.com/tip
- [x] Privacy policy hosted: https://tanookistudios.com/apps/subswap/privacy
- [ ] Declare trader / non-trader status — **read this one carefully**, traders
      have to publish a contact address on the listing, and it's public
- [ ] Verify `madilynthomas.com` in Search Console to become a verified publisher
- [ ] Screenshots: `walkthrough.png` shows the first-install explainer — probably
      the best single image for the listing
- [ ] Screenshots: `store/screenshots/` now has `about.png` and `support.png` too
      — decide whether the tip jar is one you want on the listing
- [ ] Upload the icon (`src/icons/icon-128.png`) and the screenshots
- [ ] Consider publishing **Unlisted** first — still reviewed, but not listed in
      search or categories while you find out whether it passes
