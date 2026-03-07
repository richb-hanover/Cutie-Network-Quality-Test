# WebRTC Reliability Design

## Goal

Improve WebRTC connection reliability by (1) rewriting ICE candidate handling to connect faster and more cleanly, and (2) adding comprehensive disconnect logging to diagnose the 25% unexpected disconnection rate.

## Architecture

Two focused changes to the existing WebRTC layer, both confined to `src/lib/rtc-client.ts`, `src/lib/webrtc.ts`, and `src/routes/api/webrtc/+server.ts`. No changes to the GUI, probe logic, or signaling API contract.

## Tech Stack

SvelteKit + TypeScript, `@roamhq/wrtc` (server-side WebRTC), existing `logger` from `$lib/logger`.

---

## Item 1: ICE Candidate Handling Rewrite

### Problem

`waitForIceGatheringComplete` in `rtc-client.ts` blocks for up to 15 seconds before sending the SDP offer to the server. This causes worst-case connection times of ~17s and a confusing "Connecting..." state.

### Approach

**Short gather + return on data channel open.**

- Replace the 15s gather wait with a 1.5s timeout. The offer is sent to the server as soon as ICE gathering completes or 1.5s elapses, whichever comes first.
- After the offer is sent and the server answer is received, continue listening for late-arriving local ICE candidates and add each one directly to the peer connection via `peer.addIceCandidate()` (client-side only — no server involvement).
- The candidate listener is removed only when the data channel opens.
- `createServerConnection()` returns as soon as the data channel opens, unchanged public signature.

### Changes to `rtc-client.ts`

1. **`waitForIceGatheringComplete` → `waitForIceCandidatesWithTimeout(peer, 1500)`**
   - Same logic, timeout reduced from 15 000 ms to 1 500 ms.

2. **`negotiate()` — keep candidate listener alive after offer is sent**
   - Currently: listener removed at end of `negotiate()`.
   - New: listener stays active; each new candidate calls `peer.addIceCandidate(normaliseLocalCandidate(candidate))`.
   - Listener removed inside `channelPromise` resolution (when data channel opens).

3. **logger() calls added at:**
   - "Starting ICE gather"
   - "ICE gather ended: N candidates (complete | timeout)"
   - "Sending offer to server"
   - "Answer received: N remote candidates"
   - "Adding remote candidate N/total: type=X"
   - "Data channel open — connection established (connectionId: X)"

4. **Error strings** — no change needed; existing throw messages already surface to the GUI via `errorMessage`.

### What does NOT change

- Single HTTP POST signaling contract (`/api/webrtc`).
- `createServerConnection()` public API.
- Address normalisation logic.
- Server-side code for Item 1.

---

## Item 2: Disconnect Logging

### Problem

When a connection drops unexpectedly (~25% of runs, often after many minutes), there is insufficient log output to understand whether the failure is ICE, data channel, server-side close, or network-level.

### Approach

**Structured logging at every unexpected close path, on both client and server. No reconnect logic.**

### Changes to `webrtc.ts` (client side)

In the `dataChannel` `close` event handler and `peerConnection` `connectionstatechange` handler, when the reason is not `manual` or `auto`, log a structured snapshot before calling `disconnect()`:

```
[webrtc] Unexpected disconnect — connectionState=<X> iceConnectionState=<Y>
  dataChannelState=<Z> lastProbeSeq=<N> lastProbeAgeMs=<T> elapsedMs=<E> reason=<R>
```

Fields:

- `connectionState` — `RTCPeerConnectionState` at time of close
- `iceConnectionState` — `RTCIceConnectionState` at time of close
- `dataChannelState` — `RTCDataChannelState` at time of close
- `lastProbeSeq` — sequence number of last received probe (from `latencyStats`)
- `lastProbeAgeMs` — ms since last probe was received
- `elapsedMs` — ms since collection started (`Date.now() - collectionStartAt`)

### Changes to `src/routes/api/webrtc/+server.ts` (server side)

When the server-side peer connection state changes to `disconnected`, `failed`, or `closed`:

```
[webrtc-server] Connection <connectionId> closed: state=<X> reason=<clean|unexpected>
  lastMessageAt=<ISO> openDurationMs=<D>
```

- `reason=clean` when a DELETE request was already received for this connectionId before the state change.
- `reason=unexpected` when the state change arrives without a preceding DELETE.
- `lastMessageAt` — timestamp of last message received on the data channel.
- `openDurationMs` — time from data channel open to close.

No reconnect, no state changes — pure observability.

---

## Files Changed

| File                               | Change                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/rtc-client.ts`            | Reduce gather timeout to 1.5s; keep candidate listener alive post-offer; add logger calls |
| `src/lib/webrtc.ts`                | Add structured log snapshot on unexpected disconnect                                      |
| `src/routes/api/webrtc/+server.ts` | Track `lastMessageAt` and `openedAt` per connection; log on unexpected close              |
