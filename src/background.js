// The service worker does a few small jobs and nothing else:
//
//  1. Toolbar click -> open (or focus) the manager tab.
//  2. Act as a timer service for the manager page.
//  3. Open the manager once on install, and register where Chrome should send
//     someone when they uninstall.
//
// (2) needs explaining. Chrome throttles setTimeout hard in tabs that are
// hidden or occluded, and during a run the manager tab is usually behind the
// YouTube tab. A 6-second gap would silently become a 60-second one. Service
// workers aren't documents, so they aren't subject to that throttling — the
// manager asks us to wake it, we do it on time. The manager chunks long waits
// into short hops so the messages themselves keep this worker alive.

const MANAGER_URL = chrome.runtime.getURL("src/manager.html");

// Chrome opens this by itself when the extension is removed — after it's gone,
// so there is nothing left running to send anything. The version rides along
// because "it broke in 1.0.4" is the only useful kind of answer; nothing else
// does, and there is nothing else to send. The page says as much.
const FAREWELL_URL = "https://tanookistudios.com/apps/subswap/goodbye";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.runtime.setUninstallURL(`${FAREWELL_URL}?v=${chrome.runtime.getManifest().version}`);

  // A freshly installed extension with no window is just an unexplained new
  // icon. Opening the manager once is the only way the walkthrough gets seen.
  // Updates don't, because interrupting someone to say "I updated" is rude.
  if (reason === "install") chrome.tabs.create({ url: MANAGER_URL });
});

// onInstalled only fires on install and update, and the worker gets shut down
// constantly — so the uninstall URL is set again whenever it starts up, or a
// browser restart would quietly lose it.
chrome.runtime.setUninstallURL(`${FAREWELL_URL}?v=${chrome.runtime.getManifest().version}`);

chrome.action.onClicked.addListener(async () => {
  const existing = await chrome.tabs.query({ url: MANAGER_URL });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: MANAGER_URL });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "subswap-timer") return;

  const timers = new Set();

  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "sleep") return;
    const handle = setTimeout(() => {
      timers.delete(handle);
      try {
        port.postMessage({ type: "wake", id: msg.id });
      } catch {
        // Manager tab went away mid-wait. Nothing to do.
      }
    }, Math.max(0, msg.ms | 0));
    timers.add(handle);
  });

  port.onDisconnect.addListener(() => {
    for (const handle of timers) clearTimeout(handle);
    timers.clear();
  });
});
