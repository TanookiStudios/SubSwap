// Pure helpers for identifying and comparing channels. No browser APIs in
// here — this file is unit-tested under plain node.

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,24}$/;

export function normaliseHandle(handle) {
  if (!handle) return null;
  const trimmed = String(handle).trim().replace(/^@+/, "").toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normaliseChannelId(id) {
  if (!id) return null;
  const trimmed = String(id).trim();
  return CHANNEL_ID_RE.test(trimmed) ? trimmed : null;
}

// Titles are the last-resort match, so squash everything that could plausibly
// differ between two renderings of the same name.
export function normaliseTitle(title) {
  if (!title) return null;
  const squashed = String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return squashed.length > 0 ? squashed : null;
}

// Avatar URLs come off YouTube protocol-relative as often as not
// ("//yt3.ggpht.com/…"). That works inside a page but breaks anywhere the
// export is opened from something other than https — in a desktop app it
// resolves to file://yt3.ggpht.com and quietly shows nothing. Normalise once,
// here, so every consumer gets a URL it can actually load.
export function normaliseAvatar(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

// Accepts a full URL or a YouTube-relative path.
export function parseChannelUrl(url) {
  if (!url) return { channelId: null, handle: null };
  let path = String(url).trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return { channelId: null, handle: null };
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { channelId: null, handle: null };

  if (segments[0] === "channel" && segments[1]) {
    return { channelId: normaliseChannelId(segments[1]), handle: null };
  }
  if (segments[0].startsWith("@")) {
    return { channelId: null, handle: normaliseHandle(segments[0]) };
  }
  // /c/Name and /user/Name are legacy vanity paths. They still resolve, but
  // they aren't a stable identity, so treat them as a handle-ish key.
  if ((segments[0] === "c" || segments[0] === "user") && segments[1]) {
    return { channelId: null, handle: normaliseHandle(segments[1]) };
  }
  return { channelId: null, handle: null };
}

// Turn whatever we scraped into the tidy shape everything else expects.
export function toChannel(raw) {
  const fromUrl = parseChannelUrl(raw.url || raw.href);
  const channelId = normaliseChannelId(raw.channelId) || fromUrl.channelId;
  const handle = normaliseHandle(raw.handle) || fromUrl.handle;
  const title = raw.title ? String(raw.title).trim() : null;
  return {
    channelId,
    handle,
    title,
    avatar: normaliseAvatar(raw.avatar),
    url: channelUrl({ channelId, handle }),
  };
}

// Channel ID first — handles can be changed by their owner, IDs can't.
export function channelUrl(channel) {
  if (channel.channelId) {
    return `https://www.youtube.com/channel/${channel.channelId}`;
  }
  if (channel.handle) {
    return `https://www.youtube.com/@${channel.handle}`;
  }
  return null;
}

export function displayName(channel) {
  return channel.title || (channel.handle ? `@${channel.handle}` : channel.channelId) || "Unknown channel";
}

// Only channels we can actually navigate to are worth keeping.
export function isUsable(channel) {
  return Boolean(channel && (channel.channelId || channel.handle));
}

export function keysOf(channel) {
  const keys = [];
  if (channel.channelId) keys.push(`id:${channel.channelId}`);
  if (channel.handle) keys.push(`handle:${channel.handle}`);
  const title = normaliseTitle(channel.title);
  if (title) keys.push(`title:${title}`);
  return keys;
}

export function dedupe(channels) {
  const seen = new Set();
  const out = [];
  for (const raw of channels) {
    const channel = toChannel(raw);
    if (!isUsable(channel)) continue;
    // Match on ID or handle only. Two different channels can share a title.
    const identityKeys = keysOf(channel).filter((k) => !k.startsWith("title:"));
    if (identityKeys.some((k) => seen.has(k))) {
      continue;
    }
    for (const key of identityKeys) seen.add(key);
    out.push(channel);
  }
  return out;
}

// Everything in `source` that isn't already in `existing`.
//
// Matching cascades: channel ID, then handle, then normalised title. The title
// pass matters because a channel exported years ago may have changed its handle
// since, and we'd rather skip it than subscribe twice.
export function diffChannels(source, existing) {
  const have = new Set();
  for (const raw of existing) {
    const channel = toChannel(raw);
    for (const key of keysOf(channel)) have.add(key);
  }
  const missing = [];
  for (const channel of dedupe(source)) {
    if (keysOf(channel).some((key) => have.has(key))) continue;
    missing.push(channel);
  }
  return missing;
}
