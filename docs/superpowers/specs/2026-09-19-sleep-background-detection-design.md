# Sleep & Background Detection Design

**Date:** 2026-09-19  
**Status:** Superseded on 2026-09-20. Its central assumption (hidden desktop pages keep sending probes at the full rate, and only sleep stops them) was disproved by measurements. See `docs/Browser Background Behavior.md` for the data and the design that replaced it.

## Problem

When a laptop lid closes, a screen locks, a computer sleeps, or a mobile user switches to another tab, the browser freezes JavaScript timers. This causes several problems for Cutie:

- Probes stop sending, but the session appears to continue
- All pending probes time out simultaneously on wake, producing a spurious packet-loss spike
- The 2-hour auto-stop `setTimeout` is also frozen, so sessions can run well past 2 hours
- The "Now" stats panel shows stale data; charts show unexplained gaps

## Key Insight: Probe Count as a Signal

On desktop and laptop, JavaScript timers **keep running** when the user switches tabs — probes continue to flow. Sleep/lid-close **freezes** everything. This difference lets us distinguish the two cases without any platform-specific APIs:

| Scenario | JS timers | Probes received while hidden? |
|---|---|---|
| Desktop/laptop — tab switch | Keep running | Yes |
| Desktop/laptop — sleep / lid close | Frozen | No |
| Mobile — tab switch | Frozen by browser | No |

## Decision

**Detect on wake, not on hide.** When the page becomes visible again, check whether probes flowed during the hidden period:

- Probes increased → JS was running → it was a desktop/laptop tab switch → **continue**
- Probes unchanged AND hidden >30s → JS was frozen → sleep or mobile → **stop**

This approach requires no `setTimeout`, correctly ignores desktop/laptop tab switches of any duration, and handles all sleep/freeze scenarios on both desktop and mobile.

## Behaviour

1. When collection starts (`beginCollectionSession`), attach a `visibilitychange` event listener on `document`.
2. When `document.hidden` becomes `true`: record `hiddenAt = Date.now()` and `probeCountAtHide = latencyStats.totalReceived`.
3. When `document.hidden` becomes `false`:
   - Compute `hiddenDurationMs = Date.now() - hiddenAt`.
   - Get current `totalReceived` from the latency store.
   - If `hiddenDurationMs > VISIBILITY_STOP_DELAY_MS` AND `totalReceived === probeCountAtHide` → call `disconnect('sleep')`.
   - Otherwise → clear `hiddenAt` / `probeCountAtHide` and continue.
4. When collection stops for any reason, remove the `visibilitychange` listener and clear `hiddenAt` / `probeCountAtHide`.

**Grace period:** 30 seconds (`VISIBILITY_STOP_DELAY_MS`). Forgives brief mobile tab switches (e.g., checking a URL and returning).

## Messages

Platform is detected at stop time using `isMobile()`.

| Platform | Message | Background |
|---|---|---|
| Mobile (phone / tablet) | "Collection stopped — Cutie only works when visible" | Green (`#dcfce7 / #166534`) |
| Non-mobile (desktop / laptop) | "Collection stopped — computer went to sleep" | Green (`#dcfce7 / #166534`) |

Both use the same green `.status` styling as manual and auto stops.

## Mobile Detection

```ts
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.maxTouchPoints > 0 && /Mobi|Android/i.test(navigator.userAgent);
}
```

Desktop and laptop are indistinguishable in the browser and receive the same message.

## Code Changes

All changes are confined to `src/lib/webrtc.ts`. No UI, chart, store, or probe-logic files are modified.

1. **`DisconnectReason` type** — add `'sleep'` to the union.
2. **`isMobile()` helper** — exported pure function, guards `typeof navigator`.
3. **Module variables** — `hiddenAt: number | null` and `probeCountAtHide: number | null`, both initialised to `null`.
4. **`VISIBILITY_STOP_DELAY_MS` constant** — `30_000`.
5. **`visibilityChangeHandler`** — stored reference (needed for `removeEventListener`):
   - On hide: set `hiddenAt = Date.now()`, `probeCountAtHide = get(webrtcState).latencyStats.totalReceived`
   - On show: read current `totalReceived`; if gap > 30s and no new probes → `disconnect('sleep')`; always clear `hiddenAt`/`probeCountAtHide`
6. **`beginCollectionSession()`** — after starting probes, `document.addEventListener('visibilitychange', visibilityChangeHandler)` (guarded by `typeof document !== 'undefined'`).
7. **`disconnect()`** — remove listener, clear `hiddenAt`/`probeCountAtHide`, handle `reason === 'sleep'` in message block.

## Edge Cases

| Scenario | Result |
|---|---|
| Desktop/laptop tab switch (any duration) | Probes flowed → continue |
| Laptop lid closed / sleep >30s | No probes during hide → stop on wake; green "computer went to sleep" |
| Mobile tab switch <30s | Gap too short → continue |
| Mobile tab switch >30s | No probes, gap >30s → stop on return; green "Cutie only works when visible" |
| User clicks Stop while page is hidden | Manual stop wins; `disconnect()` clears handler |
| 2-hour auto-stop fires while hidden | Auto-stop wins; existing "two hours" message shown |
| Connection error while hidden | Error stop wins; red error banner |
| `disconnect()` called re-entrantly | Guarded by existing `isDisconnecting` flag |
| SSR / no `document` | Listener attachment guarded by `typeof document !== 'undefined'`; `isMobile()` guarded by `typeof navigator !== 'undefined'` |
| Device sleeps while Cutie is already in a background tab | Same: no probes during hide → stop on wake |

## Out of Scope

- Web Workers for background probe sending (unreliable on iOS; adds significant complexity)
- Screen Wake Lock (different problem — prevents auto-sleep, not tab-switch)
- PWA / Add to Home Screen prompt (future consideration)
- Chart annotations for sleep gaps (not needed with Detect & Stop strategy)
- Distinguishing desktop from laptop in messaging
- Page Lifecycle `freeze` event (Chrome-only; the probe-count approach covers the same cases cross-browser)
