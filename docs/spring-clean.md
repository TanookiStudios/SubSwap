# Spec — Subscriptions spring clean

Status: **proposed, not built.** Ship the migration half first and let it sit
through review before adding anything destructive to it (see Sequencing).

## What it is

Show someone what's actually in their subscription list — which channels are
dead, renamed, or haven't uploaded in years — and let them unsubscribe from the
lot in one go.

## Why it's worth building

SubSwap as it stands is used once and uninstalled. Nobody migrates accounts
twice. Clean-up is the only thing in this space people come back for: feeds rot,
and tidying one is a once-or-twice-a-year job with no tool for it. YouTube lets
you unsubscribe one channel at a time and shows you nothing about which ones are
worth keeping.

It also reuses almost everything already here — the scrape, the queue, the
pacing, the resumable run. The genuinely new parts are one data source and one
screen.

---

## The data source (the important bit)

Working out "when did this channel last upload" by visiting 552 channel pages
would take about 45 minutes and pile more automation onto a Google property.

There's a much better source: **YouTube's per-channel RSS feed.**

```
https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxxxxxxxxxxxxxxxx
```

Public, no auth, no scraping, returns the most recent entries with `<published>`
timestamps. A few hundred of those fetched a handful at a time is a minute or so,
and it's a documented feed rather than a page being driven — which matters both
for speed and for how this looks to a reviewer.

**Prototype this before building anything else.** The whole design rests on it,
and the two things I have not verified are whether it still serves every channel
and whether a few hundred requests in quick succession get rate-limited. If it
does get limited, the fallback is the same queue machinery the subscribe run
uses — slow, resumable, one channel page at a time — and the feature becomes
"leave it running for an hour" rather than "wait a minute". Worth knowing which
one you're building before you design the UI around it.

### It needs channel IDs

The feed is keyed by `UC…` id. Handles don't work.

`src/inject/scrape.js` already reads `data.channelId` (falling back to
`navigationEndpoint.browseEndpoint.browseId`) from the Polymer data, so most
rows should already carry one. Rows that only produced a `/@handle` need
resolving once: load the channel page and read the canonical id out of the head
(`<meta itemprop="identifier">` / `<link rel="canonical">`), then cache it on the
saved list so it's a one-off cost per channel, ever.

Worth measuring how many of your 552 actually lack an id before writing the
fallback — it may be nearly none.

---

## Signals

Ranked by what they cost to get and how much they can be trusted:

| Signal | Source | Reliability |
| --- | --- | --- |
| Last upload date | RSS feed | High — it's a timestamp |
| Uploads in the last year | RSS feed | High |
| Channel gone / terminated | Channel page 404s, or empty feed | High |
| Renamed since you subscribed | Title differs from the saved list | Medium — people rename for innocent reasons |

Default grouping: **no uploads in 2+ years**, **no uploads in 1–2 years**,
**gone**, **renamed**, **still active**. Nothing else. Resist scoring channels or
inventing a "staleness" number — the date is the argument.

### Explicitly out of scope

**Anything based on watch history.** I said "channels you've never watched" when
I pitched this, and that was me getting ahead of the data. Watch history isn't on
the subscriptions page; it's a separate surface, it's far more sensitive than a
list of channel names, and hoovering it up would wreck the privacy line the
product is built on. Upload recency answers the same question well enough.

---

## Unsubscribing

**Do it on the subscriptions page, not one channel at a time.**
`/feed/channels` renders a subscribe button inside every `ytd-channel-renderer`
row, so a whole clean-up can happen on one loaded page — no navigation per
channel. That's minutes instead of hours, and far less automation surface.

Two changes to `src/inject/yt.js`:

1. Its button lookup is deliberately scoped to the channel header
   (`HEADER_SCOPES`) so it can never click a subscribe button in a sidebar. It
   needs a second scope: "the button inside *this* list row", passed an explicit
   row index or channel id. Keep the existing scoping as-is — the whole reason
   it's narrow is to stop it subscribing to something nobody asked for.
2. Unsubscribing raises a confirmation dialog. That needs finding and confirming,
   and — like the subscribe check — it needs to work without matching English
   text. Look for the dialog's confirm button by role and position within
   `tp-yt-paper-dialog`/`yt-confirm-dialog-renderer` rather than by its label.

Keep the existing pacing and the three-strikes throttle guard. Unsubscribing in
bulk is exactly as likely to get rate-limited as subscribing.

---

## Undo

**The backup is the undo, and it already exists.**

Before any clean-up run, save a snapshot of the current subscription list as a
normal SubSwap list, named automatically (`Before clean-up, 3 Aug 2026`). If
someone regrets it, restoring is just a subscribe run against that list — the
whole import path is already built and tested.

This is non-negotiable and shouldn't be a checkbox. Bulk unsubscribe is
destructive and irreversible by hand; a bug that removes the wrong 200 channels
with no snapshot is unrecoverable. The snapshot costs one scrape they've already
sat through.

Offer the snapshot as a file download too, for the same reason lists are
downloadable now — extension storage doesn't survive a profile change.

---

## The screen

A third numbered step on the existing page, or a separate destination — it
doesn't warrant a new page structure either way. Reuse the job panel: the same
progress bar, live feed and tip column, since a clean-up run is the same shape of
job as a subscribe run.

- **Scan** button. Reads the list, fetches the feeds, shows a summary:
  *"552 channels. 168 haven't uploaded in over 2 years. 24 are gone."*
- Results grouped by the bands above, each group collapsed, with a count.
- **Nothing is selected by default.** The user opts in per channel or per group.
  A destructive action must never arrive pre-ticked.
- Each row: avatar, name, last upload in plain words ("last upload 3 years ago",
  "gone"), and a link to the channel so they can go and look before deciding.
- The confirm names the number and the snapshot:
  *"Unsubscribe from 168 channels? A backup is saved first, so you can put them
  back."*
- Then it runs as a normal job, with the same feed wording — *Unsubscribed from
  Quiet Workshop*.

---

## Charging for it

Migration stays free forever — that's what the about copy promises and it
shouldn't change.

Clean-up: **free up to 25 unsubscribes, one-time unlock for unlimited.** A
one-time unlock suits a tool people use once or twice a year; a subscription for
this would feel like a stitch-up and would be resented.

The free tier has to be genuinely useful on its own — the scan and the full
report stay free forever, including for people who never pay. What's gated is
bulk action past the first 25. Someone with a 60-channel list should be able to
do the whole job free and feel well treated.

Reuse the Polar license-key flow from Transcribbler. It's built, it's proven, and
Chrome Web Store payments have been dead for years so an external licence is the
only route anyway.

---

## Sequencing, and the risk

Get SubSwap through review as it is. Let it live a while. Add this in a later
version.

Bulk unsubscribe reads worse to a reviewer than bulk subscribe does — it has the
shape of account-sabotage tooling, even though here it's someone tidying their
own feed on purpose. Adding it to the first submission risks the whole thing over
a feature nobody's asked for yet.

When it does go in, the listing copy should lead with the *report* — "see which
of your subscriptions are dead" — and treat the bulk action as what you do about
it. That's the honest framing anyway: the value is knowing, and the clicking is
the chore.

---

## Build order

1. Prototype the RSS feed against your real 552-channel list. Measure hit rate,
   how many rows lack a channel id, and whether it rate-limits. **Everything
   below depends on the answer.**
2. Channel-id resolution + caching on saved lists.
3. Scan and report, read-only, no unsubscribe at all. Ship it like that if you
   want — a report that touches nothing is a much easier thing to defend, and
   it's most of the value.
4. Automatic pre-clean snapshot.
5. Row-scoped unsubscribe + confirm-dialog handling in `yt.js`.
6. The clean-up run, reusing the queue.
7. The 25-action limit and the licence check.
