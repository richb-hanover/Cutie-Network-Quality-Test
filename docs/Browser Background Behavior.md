# Browser Background Behavior

What browsers do to a Cutie page (and its WebRTC probes) when the page is
hidden: another tab, a covered or minimized window, or a closed laptop lid.
This records measurements made on 2026-09-19 so they are not lost.
Read it before changing the sleep/background detection in `src/lib/webrtc.ts`.

## Summary

- Cutie sends a probe every 100 ms from a `setInterval`. Hidden pages get their
  timers throttled or frozen, so the probe rate drops.
- **Chrome, Edge, Firefox:** a hidden page keeps running at about **1 probe per
  second**, whether the cause is a tab switch or a covered window. Nothing is
  lost. The connection stays up.
- **Safari (macOS):** a hidden page is **nearly frozen**: a few probes at about
  1 per second for the first ~15 s, then gaps of 16 to 85 s. A tab switch and a
  fully covered window behave the same. A window that is only partly covered
  runs at full speed.
- **Closed laptop lid** looks like "hidden" to the page. Firefox ran at ~0.68
  probes/s; Safari ran at ~0.013 probes/s (21 probes in 28 minutes).
- **Safari can lose the WebRTC connection while a tab is hidden.** In a clean run
  (new tab opened, left alone) only 8 probes arrived in 185 s, and the connection
  was `failed` when the page thawed. The server's records no longer listed it (see "Safari
  drops the connection when hidden" below). Short Safari hides (up to about 27 s)
  were survived repeatedly.
- **Latency measured while hidden is biased upward** in every browser tested with
  enough data: median about +1 to +2.5 ms, p95 about +15 to +29 ms. Jitter
  computed from hidden-period samples is therefore not comparable with foreground
  numbers.
- **No probes are reported lost** during hidden periods. Probes that are never
  sent are not counted as lost, so the packet-loss figure stays honest.
- The original (now removed) design assumed "on desktop, hidden pages keep sending
  at the full rate; only sleep stops them". That is wrong. Its check,
  `totalReceived === probeCountAtHide`, fired only on a complete freeze, so it
  missed Safari (a handful of probes still arrive) and any throttled page.

## Test setup

- One MacBook running macOS (all user agents report `Mac OS X 10_15_7` or
  `10.15`). Vite dev server (`npm run dev`) on the same machine, browsers on
  `http://localhost:5173`. Round trip is about 1 to 2 ms, so small delays show up
  clearly.
- Browsers (from the user-agent strings): Firefox 156.0, Chrome 155, Edge 131,
  Safari 26.6.2.
- Method: a temporary diagnostic in `src/lib/webrtc.ts` (log lines starting `DIAG`)
  summarised each visible and hidden period: duration, probes received and lost,
  latency p50/p95/max, and the spacing between sent probes. It has since been
  removed.
- Caveats: one machine, one operating system, mostly one run per case. For a time
  the four browsers ran side by side against the same server, so there is some
  noise. Percentiles from fewer than about 50 samples are rough. The "partly
  covered Safari window" result is a single 7.6-minute observation, and how much
  of the window was showing is not known.

## Results

"Rate" is probes received per second of hidden time. At the throttled rate of
1 per second, 100% means 1 probe/s.

### Visible baseline (all browsers)

| Browser                       | Period  | Probes | Latency p50 / p95 | Spacing p50 |
| ----------------------------- | ------- | ------ | ----------------- | ----------- |
| Firefox                       | 212.8 s | 2,068  | 2.0 / 5.0 ms      | 103 ms      |
| Chrome                        | 396.3 s | 3,959  | 2.0 / 3.1 ms      | 100.0 ms    |
| Edge                          | 19.0 s  | 190    | 1.6 / 3.2 ms      | 100.1 ms    |
| Safari                        | 125.5 s | 1,206  | 2.0 / 4.0 ms      | 104 ms      |
| Safari, window partly covered | 456.9 s | 4,387  | 2.0 / 3.0 ms      | 104 ms      |

### Hidden (tab switch or window covered), long periods

| Browser                           | Hidden  | Probes | Rate | Spacing p50 / max | Latency p50 / p95    |
| --------------------------------- | ------- | ------ | ---- | ----------------- | -------------------- |
| Chrome                            | 446.5 s | 447    | 100% | 1000.0 / 1090 ms  | 4.5 / 32.4 ms        |
| Edge                              | 277.8 s | 278    | 100% | 1000.1 / 1005 ms  | 3.1 / 18.2 ms        |
| Firefox                           | 468.9 s | 445    | 95%  | 1011 / 2211 ms    | 3.0 / 25.0 ms        |
| Safari (browsers mixed)           | 514.5 s | 9      | 1.7% | 1096 / 17,609 ms  | not meaningful (n=9) |
| Safari, tab switch in same window | 359.3 s | 9      | 2.5% | 1192 / 15,964 ms  | not meaningful       |
| Safari, covered by Terminal       | 179.5 s | 12     | 6.7% | 2267 / 61,823 ms  | not meaningful       |

Shorter hidden periods: Chrome 41.9 s gave 42 probes (spacing 999.9 ms, latency
p50 3.6 / p95 22.0 ms). Firefox 30.8 s gave 30 probes (latency 4.0 / 26.0 ms).
Safari 27.1 s gave 16 probes (all gaps <= 1.1 s), Safari 22.8 s gave 9 probes
(largest gap 5.4 s), and Safari 5.9 s gave 6 probes. Safari therefore runs at
about 1 probe/s for the first ~15 s of a hide and then nearly stops.

### Laptop lid closed

| Browser | Hidden                   | Probes | Rate                     | Notes                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------ | ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firefox | 476 s (about 8 min)      | 326    | 68% (average gap 1.46 s) | Recorded by the `visibilitychange` log: sent 466 to 793, received 466 to 792, lost 0. The connection stayed up, so the machine apparently never fully slept.                                                                                                                                    |
| Safari  | 1,669.9 s (about 28 min) | 21     | 1.3%                     | Median gap 20.2 s, largest 85.1 s, lost 0. Latency p50 17 / p95 357 ms for those 21 probes is meaningless (wake-up blips). Only DIAG lines were captured, so the connection state is unknown. No `-final` line followed the wake-up, so no automatic disconnect showed up in the pasted output. |

Not tested: lid close on Chrome or Edge.

### Other observations

- Latency bias while hidden (Chrome, Edge, Firefox): median +1.0 to +2.5 ms and
  p95 +15 to +29 ms compared with the same browser visible. The same pattern
  appears in all three engines, so it is probably the operating system running
  background pages at low priority. That mechanism is a guess.
- Safari once showed `lost=1` in a visible period (19:56:43, 1,298 probes). It may
  be a leftover from a freeze/thaw boundary; not investigated.
- The `visibilitychange` event always fired at the right moment (hide and show),
  including in Safari, so a handler on hide runs immediately even if the page then
  freezes.

## What the documentation says

- Chrome: hidden pages get timers checked once per second. From Chrome 88, pages
  hidden for 5 minutes or more with chained timers are limited to once per minute
  ("intensive throttling"), but pages with an open WebRTC data channel are exempt.
  This matches the measurements (Chrome stayed at 1 probe/s for 7.4 minutes).
  Source: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- Edge is Chromium-based, so it should throttle timers like Chrome (matches the
  measurements). Edge's "Sleeping tabs" freezes background tabs after 2 hours of
  inactivity by default, and the documented exemption list does not mention WebRTC
  connections. Untested here; our longest Edge hide was under 5 minutes.
  Source: https://support.microsoft.com/en-us/edge/learn-about-performance-features-in-microsoft-edge
- Safari: no authoritative source found. The measurements above are the evidence.

## Safari drops the connection when hidden (partly explained)

The user reported that opening another tab in the Cutie window makes the WebRTC
connection time out after a while. A full, unfiltered console log of that case was
captured (Safari 26.6.2, 2026-09-19):

- 20:53:05 Start. 20:53:40 tab hidden (330 probes so far, visible period 34.3 s).
- Hidden for 184.7 s: only 8 probes received (4%), largest gap 16.4 s, none lost.
- 20:56:44.796 the page thawed and the first thing it saw was
  `Peer connection state: failed`. Cutie stopped itself with reason `error`
  ("Lost connection to the server...").
- The console then showed `Failed to load resource: 404`. That is the client's
  `DELETE /api/webrtc?id=...` (`rtc-client.ts` `close()`), which the server answers
  with 404 "Connection not found or already closed" when the connection has
  already been finalized (`src/routes/api/webrtc/+server.ts`, DELETE handler). The
  server had removed it from its records while the page was frozen. As the next
  section shows, that happened when the peer became `disconnected`, which is not
  the same as the connection being closed. The client learned the outcome on thaw.

### What the server log shows (Safari, 2026-09-20)

With the visibility beacons on, a 37.9 s tab hide produced this in the server log:

| Time        | Server log                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| 08:20:16.7  | `visibility-hidden` beacon                                                                                |
| 08:20:24    | last probe from this client (the `lastMessageAt` value): Safari ran the page for about 8 s, then froze it |
| 08:20:34.4  | `UNEXPECTED connection close ... state=disconnected`                                                      |
| 08:20:42.2  | `Connection state changed ... connected`                                                                  |
| 08:20:54.57 | `Connection state changed ... connected`                                                                  |
| 08:20:54.58 | `visibility-visible` beacon                                                                               |

- The server then treated `disconnected` like a close: it logged UNEXPECTED and removed
  the connection from its records, but never closed the peer connection. The connection
  recovered twice, and the second flap went unlogged because the record was gone.
- On a reload, the old page sends a `visibility-hidden` beacon between `beforeunload`
  and `unload`. That is not a real hide.
- Fixed 2026-09-20: `handleConnectionStateChange()` in
  `src/lib/server/webrtcRegistry.ts` now only ends a connection on `failed` or
  `closed`. `disconnected` logs "Connection disconnected (may recover)" and keeps the
  connection registered; the return to `connected` logs "Connection recovered ... after
  N ms disconnected". Watch for these lines to see how long a hidden Safari
  connection survives, and when it finally fails.
- Risk: a peer stuck in `disconnected` that never reaches `failed` would now stay in the
  server's active-connection list. No such case has been seen. Earlier logs show a
  vanished client reaching `failed` about 15 to 16 s later.

Still unknown: how long a hidden Safari connection can stay `disconnected` before it
fails for good (the 20:53 run failed within 3 minutes).

What the earlier Safari runs now suggest (needs the unfiltered logs to confirm):

- The 359 s tab-switch run ended with `visible-final durationS=0.0` only 14 ms after
  the page became visible. A person cannot click Stop that fast, so that Stop was
  almost certainly automatic, probably the same connection failure. An earlier
  version of this document wrongly assumed the user clicked Stop.
- Short Safari hides (5.9 s, 22.8 s, 27.1 s) were followed by normal full-rate
  collection, so the connection survived those.
- The 28-minute lid-close run showed no `-final` line after wake-up, so the
  connection may have survived a closed lid even though a 3-minute tab hide did
  not. A guess: with the lid closed the whole system sleeps and its clock stops, so
  ICE connectivity checks never time out, while a suspended app on an awake machine
  keeps missing them. Untested.
- The user's statement that Cutie "runs slowly" when another window covers it is
  only partly right. Measured: a partly covered window runs at full speed, and a
  fully covered window is nearly frozen (2 to 7% of the throttled rate), not
  merely slow.

Where to look next time it happens:

- Browser console: `Peer connection state: failed`, `datachannel onError`,
  `dataChannel closed`, and the `DIAG` lines.
- Server log: `UNEXPECTED connection close: id=... state=failed iceState=failed
lastMessageAt=... openDurationMs=...` (`src/routes/api/webrtc/+server.ts`,
  around lines 158 to 169). Compare `lastMessageAt` and `openDurationMs` with the
  time the tab was hidden.
- Code facts: `src/lib/server/webrtcRegistry.ts` only records `lastMessageAt`; no
  application-level stale timer was found. The client raises
  `Lost connection to the server...` when the peer connection state becomes
  `failed` or the data channel closes (`src/lib/rtc-client.ts`, around lines
  427 to 450).
- Reference: when a client vanished abruptly (page reload), the server logged
  `UNEXPECTED connection close ... state=failed iceState=failed` about 15 to 16
  seconds later, so that is the expected ICE failure delay.

## What Cutie does now (implemented 2026-09-20)

Cutie never stops itself because the page was hidden. Code: `src/lib/background-gap.ts`
(the rules) and `handleVisibilityChange()` in `src/lib/webrtc.ts` (the wiring).

- **Probing resumes by itself.** When a frozen page thaws, its timers run again and
  probes go back to 10 per second. Cutie charts whatever arrived.
- **Yellow notice.** When the page becomes visible again after more than 30 s hidden,
  and fewer than half of the 1 probe/s that Chrome, Edge and Firefox keep sending
  arrived, Cutie shows "Some samples were not collected while Cutie was in the
  background" on a yellow background. It removes itself after 15 s. A newer notice
  restarts the timer, so an old timer cannot clear it early. On the measurements
  above this fires for Safari (1.3 to 7%) and stays quiet for Chrome, Edge and
  Firefox (68 to 100%).
- **Two-hour limit.** When the page becomes visible, a session older than two hours
  stops with the green "Collection stopped after two hours." message. `disconnect()`
  also turns an `error` or `timeout` stop into that same stop when the session is past
  two hours, because the failed-connection event can reach the page before the
  visibility event. The two-hour `setTimeout` is still there for pages that are not
  throttled.
- **Lost connection while hidden.** The red message says "Lost connection to the
  server while Cutie was in the background" when the page was hidden, or became
  visible less than 10 s earlier.
- **No auto-reconnect.** A dropped connection (Safari after a few minutes hidden)
  ends the session; the user clicks Start.

The server log also shows when a window is hidden or shown: `lifecycle-beacon.ts` sends
`visibility-hidden` and `visibility-visible` beacons to `/api/beacon`, which the server
logs as `{"connectionId":...,"reason":"visibility-hidden","state":"hidden"}`. Compare
those times with `UNEXPECTED connection close` lines to see how long a hidden window
kept its connection. These beacons had been commented out since 2025-12-15 and were
turned back on on 2026-09-20.

Removed: the `sleep` stop reason and its messages, `isMobile()`, and the diagnostic
logging used to collect the measurements above. Cutie now logs one line each time the
page becomes visible ("Visible again after N s hidden: received M probes ...").

Deliberately not done: drawing the gap differently in the charts (they show what
arrived), and flagging hidden-period samples despite their small upward latency bias.

Still untested: Windows and Linux; Chrome and Edge with the lid closed; Edge with a
page hidden for 2 hours; minimized windows; mobile browsers; how long Safari can stay
hidden before the connection is lost (the server log for the 20:53 run was not
captured).
