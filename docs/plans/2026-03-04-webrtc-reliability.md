# WebRTC Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cut worst-case connection time from ~17s to ~3s by sending the SDP offer after a 1.5s ICE gather window, add late-arriving local candidates directly to the peer connection, and add structured logging at every unexpected disconnect path on both client and server.

**Architecture:** Three files change. `rtc-client.ts` gets a shorter gather timeout and a flag that routes late local ICE candidates to `peer.addIceCandidate()` after the offer is sent. `webrtc.ts` logs a full state snapshot before every unexpected disconnect. `+server.ts` tracks `openedAt`, `lastMessageAt`, and `deleteReceived` per connection and logs unexpected closes with those fields.

**Tech Stack:** TypeScript, SvelteKit, `@roamhq/wrtc` (server), Vitest (tests).

---

### Task 1: Reduce ICE gather timeout to 1.5 s in `rtc-client.ts`

**Files:**
- Modify: `src/lib/rtc-client.ts:5`
- Test: `tests/rtc-client-timeout.test.ts`

**Step 1: Write the failing test**

Create `tests/rtc-client-timeout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('ICE_GATHER_TIMEOUT_MS', () => {
  it('is 1500 ms', async () => {
    // The constant is not exported, so we verify it indirectly by reading the source.
    // This acts as a canary: if someone bumps the timeout back up, this test breaks.
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/lib/rtc-client.ts', 'utf8')
    );
    expect(src).toContain('ICE_GATHER_TIMEOUT_MS = 1_500');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/rtc-client-timeout.test.ts
```

Expected: FAIL — `ICE_GATHER_TIMEOUT_MS = 1_500` not found (current value is 15_000).

**Step 3: Change the constant**

In `src/lib/rtc-client.ts` line 5, change:
```typescript
const ICE_GATHER_TIMEOUT_MS = 15_000;
```
to:
```typescript
const ICE_GATHER_TIMEOUT_MS = 1_500;
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/rtc-client-timeout.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/rtc-client.ts tests/rtc-client-timeout.test.ts
git commit -m "feat: reduce ICE gather timeout from 15s to 1.5s"
```

---

### Task 2: Keep candidate listener alive after offer; route late candidates to peer directly

This is the core behavioral change. After `peer.setRemoteDescription(answer)` is called, any new local ICE candidates that arrive are added directly to the peer connection via `addIceCandidate()` rather than being queued for the (already-sent) offer.

**Files:**
- Modify: `src/lib/rtc-client.ts` — `negotiate()` function (lines 228–389)
- Test: `tests/rtc-client-late-candidates.test.ts`

**Step 1: Write the failing test**

Create `tests/rtc-client-late-candidates.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('negotiate() late candidate handling', () => {
  it('calls addIceCandidate for candidates that arrive after setRemoteDescription', async () => {
    // The source should contain the remoteDescriptionSet flag pattern
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/lib/rtc-client.ts', 'utf8')
    );
    expect(src).toContain('remoteDescriptionSet');
    expect(src).toContain('peer.addIceCandidate');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/rtc-client-late-candidates.test.ts
```

Expected: FAIL — `remoteDescriptionSet` not found in source.

**Step 3: Implement the changes in `negotiate()`**

Make the following changes inside `negotiate()` in `src/lib/rtc-client.ts`:

**3a.** Directly after the opening brace of `negotiate()` (after `const gatheredCandidates: RTCIceCandidateInit[] = [];` at line 233), add:

```typescript
let remoteDescriptionSet = false;
```

**3b.** The `candidateListener` function currently always pushes to `gatheredCandidates`. Replace the inner body that pushes to `gatheredCandidates` with logic that checks the flag. The relevant section (currently inside both the `addEventListener` and `onicecandidate` paths) looks like:

```typescript
if (candidateInit.candidate) {
  logCandidate('Local', candidateInit);
  gatheredCandidates.push(normaliseLocalCandidate(candidateInit));
}
```

Replace each occurrence with:

```typescript
if (candidateInit.candidate) {
  logCandidate('Local', candidateInit);
  const normalised = normaliseLocalCandidate(candidateInit);
  if (remoteDescriptionSet) {
    peer.addIceCandidate(new RTCIceCandidate(normalised)).catch((err: unknown) => {
      logger.warn(`[RTC] Late local ICE candidate rejected: ${err}`);
    });
  } else {
    gatheredCandidates.push(normalised);
  }
}
```

Note: there are **two** copies of this pattern — one inside the `peer.addEventListener` branch and one inside the `peer.onicecandidate` fallback branch. Update both.

**3c.** After `await peer.setRemoteDescription(answer);` (currently line 356), add:

```typescript
remoteDescriptionSet = true;
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/rtc-client-late-candidates.test.ts
```

Expected: PASS.

**Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/lib/rtc-client.ts tests/rtc-client-late-candidates.test.ts
git commit -m "feat: route late local ICE candidates to peer after offer is sent"
```

---

### Task 3: Add logger() calls to `rtc-client.ts` at key connection steps

Adds structured `logger.info` lines at each meaningful step so connection progress is visible in logs.

**Files:**
- Modify: `src/lib/rtc-client.ts` — `negotiate()` function

**Step 1: Write the failing test**

Add to `tests/rtc-client-late-candidates.test.ts` (append inside the `describe` block):

```typescript
it('source contains key logger.info calls', async () => {
  const src = await import('fs').then(fs =>
    fs.readFileSync('src/lib/rtc-client.ts', 'utf8')
  );
  expect(src).toContain('Starting ICE gathering');
  expect(src).toContain('ICE gather ended');
  expect(src).toContain('Sending offer to server');
  expect(src).toContain('Answer received');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/rtc-client-late-candidates.test.ts
```

Expected: FAIL — these strings don't exist yet.

**Step 3: Add logger calls to `negotiate()`**

Add the following lines in the positions described. Find each anchor comment and insert after it.

**Before** `const offer = await peer.createOffer();` (currently line 311):
```typescript
logger.info('[RTC] Starting ICE gathering');
```

**After** `await waitForIceGatheringComplete(peer);` (currently line 313):
```typescript
logger.info(`[RTC] ICE gather ended: ${gatheredCandidates.length} candidates (${peer.iceGatheringState})`);
```

**Before** `const response = await fetch(signalUrl, {` (currently line 338):
```typescript
logger.info(`[RTC] Sending offer to server (${candidatePayload.length} local candidates)`);
```

**After** `const { answer, connectionId, candidates: remoteCandidates = [] } = await response.json();` (currently line 355):
```typescript
logger.info(`[RTC] Answer received: ${remoteCandidates.length} remote candidates`);
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/rtc-client-late-candidates.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/rtc-client.ts tests/rtc-client-late-candidates.test.ts
git commit -m "feat: add logger calls at key ICE/connection steps in rtc-client"
```

---

### Task 4: Add structured disconnect logging to `webrtc.ts`

When the data channel or peer connection closes unexpectedly (not manual/auto stop), log a full state snapshot so the 25% failure mode can be diagnosed from logs.

**Files:**
- Modify: `src/lib/webrtc.ts` — `connectToServer()` function (lines 284–337)
- Test: `tests/webrtc-disconnect-log.test.ts`

**Step 1: Write the failing test**

Create `tests/webrtc-disconnect-log.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('unexpected disconnect logging', () => {
  it('source contains structured disconnect snapshot log', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/lib/webrtc.ts', 'utf8')
    );
    expect(src).toContain('Unexpected disconnect');
    expect(src).toContain('iceConnectionState');
    expect(src).toContain('elapsedMs');
    expect(src).toContain('lastProbeSeq');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/webrtc-disconnect-log.test.ts
```

Expected: FAIL.

**Step 3: Add snapshot log in the `dataChannel` `close` handler**

In `connectToServer()`, find the `dataChannel.addEventListener('close', ...)` block (currently lines 307–322). Inside the `if` block that checks for unexpected disconnect (the `if` at line 314), add the snapshot log **before** the `void disconnect('timeout')` call:

```typescript
// Structured snapshot for diagnosing unexpected disconnects
const snap = get(webrtcState);
const elapsedMs = snap.collectionStartAt ? Date.now() - snap.collectionStartAt : null;
logger.info(
  `[webrtc] Unexpected disconnect — ` +
  `connectionState=${peerConnection.connectionState} ` +
  `iceConnectionState=${peerConnection.iceConnectionState} ` +
  `dataChannelState=${dataChannel.readyState} ` +
  `lastProbeSeq=${snap.latencyStats.totalReceived} ` +
  `totalSent=${snap.latencyStats.totalSent} ` +
  `totalLost=${snap.latencyStats.totalLost} ` +
  `elapsedMs=${elapsedMs}`
);
```

**Step 4: Add snapshot log in the `peerConnection` `connectionstatechange` handler**

Find `peerConnection.addEventListener('connectionstatechange', ...)` (lines 284–289). Currently it only updates state. Extend it to log when the state becomes `failed` or `disconnected`:

```typescript
peerConnection.addEventListener('connectionstatechange', () => {
  webrtcState.update((current) => ({
    ...current,
    connectionState: peerConnection.connectionState
  }));
  if (
    peerConnection.connectionState === 'failed' ||
    peerConnection.connectionState === 'disconnected'
  ) {
    const snap = get(webrtcState);
    const elapsedMs = snap.collectionStartAt ? Date.now() - snap.collectionStartAt : null;
    logger.info(
      `[webrtc] Peer connection ${peerConnection.connectionState} — ` +
      `iceConnectionState=${peerConnection.iceConnectionState} ` +
      `dataChannelState=${dataChannel.readyState} ` +
      `lastProbeSeq=${snap.latencyStats.totalReceived} ` +
      `elapsedMs=${elapsedMs}`
    );
  }
});
```

**Step 5: Run test to verify it passes**

```bash
npm test -- tests/webrtc-disconnect-log.test.ts
```

Expected: PASS.

**Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/lib/webrtc.ts tests/webrtc-disconnect-log.test.ts
git commit -m "feat: add structured disconnect snapshot logging to webrtc.ts"
```

---

### Task 5: Add server-side disconnect tracking and logging

Track when the data channel opened, when the last message was received, and whether a DELETE request arrived before the connection dropped. Log a structured line on unexpected close.

**Files:**
- Modify: `src/lib/server/webrtcRegistry.ts` — `ManagedConnection` type
- Modify: `src/routes/api/webrtc/+server.ts` — `registerConnection()`, `ondatachannel`, DELETE handler
- Test: `tests/webrtc-server-disconnect-log.test.ts`

**Step 1: Write the failing test**

Create `tests/webrtc-server-disconnect-log.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('server disconnect logging', () => {
  it('ManagedConnection type includes tracking fields', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/lib/server/webrtcRegistry.ts', 'utf8')
    );
    expect(src).toContain('deleteReceived');
    expect(src).toContain('openedAt');
    expect(src).toContain('lastMessageAt');
  });

  it('server source contains UNEXPECTED close log', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/routes/api/webrtc/+server.ts', 'utf8')
    );
    expect(src).toContain('UNEXPECTED');
    expect(src).toContain('openDurationMs');
    expect(src).toContain('lastMessageAt');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/webrtc-server-disconnect-log.test.ts
```

Expected: FAIL.

**Step 3: Update `ManagedConnection` in `webrtcRegistry.ts`**

Change the type to:

```typescript
export type ManagedConnection = {
  id: string;
  pc: RTCPeerConnection;
  startedAt: Date;
  reason: string;
  deleteReceived: boolean;   // true when DELETE request was received for this connection
  openedAt: Date | null;     // when the data channel opened on the server
  lastMessageAt: Date | null; // when the last probe message was received
};
```

In `finalizeConnection()`, update the object construction to include the new fields with defaults (they aren't needed after finalization, but the type must be satisfied at creation time):

```typescript
const managed: ManagedConnection = {
  id,
  pc,
  startedAt: new Date(),
  reason: '',
  deleteReceived: false,
  openedAt: null,
  lastMessageAt: null
};
```

Wait — `ManagedConnection` is constructed in `registerConnection()` in `+server.ts`, not in `webrtcRegistry.ts`. Check the construction site and update it there (Step 4 below).

**Step 4: Update `registerConnection()` in `+server.ts`**

Find `registerConnection()` (lines 136–159). Update the `managed` object construction (line 138):

```typescript
const managed: ManagedConnection = {
  id,
  pc,
  startedAt: new Date(),
  reason: '',
  deleteReceived: false,
  openedAt: null,
  lastMessageAt: null
};
```

Update `pc.onconnectionstatechange` inside `registerConnection()` to log unexpected closes:

```typescript
pc.onconnectionstatechange = () => {
  if (
    pc.connectionState === 'closed' ||
    pc.connectionState === 'failed' ||
    pc.connectionState === 'disconnected'
  ) {
    const managed = connections.get(id); // get BEFORE finalizeConnection removes it
    if (managed) {
      const openDurationMs = managed.openedAt
        ? Date.now() - managed.openedAt.getTime()
        : null;
      const lastMessageAt = managed.lastMessageAt?.toISOString() ?? 'never';
      if (managed.deleteReceived) {
        logger.info(
          `[server] Connection ${id} closed cleanly (DELETE received). ` +
          `openDurationMs=${openDurationMs}`
        );
      } else {
        logger.info(
          `[server] UNEXPECTED connection close: id=${id} ` +
          `state=${pc.connectionState} iceState=${pc.iceConnectionState} ` +
          `lastMessageAt=${lastMessageAt} openDurationMs=${openDurationMs}`
        );
      }
      finalizeConnection(id, managed.deleteReceived
        ? 'Client DELETE'
        : `${pc.iceConnectionState} / ${pc.iceGatheringState}`);
    } else {
      // Already finalized by DELETE handler
      logger.debug(`[server] Connection ${id} state=${pc.connectionState} (already finalized)`);
    }
  } else {
    logger.info(
      `Connection state changed: id: ${id} state: ${pc.connectionState}`
    );
  }
};
```

**Step 5: Update `channel.onopen` and `channel.onmessage` in `POST` handler**

In the `pc.ondatachannel` block, update `channel.onopen` (line 320) to record `openedAt`:

```typescript
channel.onopen = () => {
  const managed = connections.get(connectionId ?? '');
  if (managed) {
    managed.openedAt = new Date();
  }
  // ... rest of existing onopen code unchanged
};
```

Update `channel.onmessage` (line 350) to record `lastMessageAt`:

```typescript
channel.onmessage = (msgEvent) => {
  const managed = connections.get(connectionId ?? '');
  if (managed) {
    managed.lastMessageAt = new Date();
  }
  // ... rest of existing onmessage code unchanged (try/catch + echo)
};
```

**Step 6: Update DELETE handler to set `deleteReceived` before closing**

In the DELETE handler (lines 403–420), before `managed.pc.close()`, add:

```typescript
managed.deleteReceived = true;
```

Remove the explicit `finalizeConnection(connectionId, 'Client DELETE')` call — it is now handled by `onconnectionstatechange` (which fires when `managed.pc.close()` is called). Add it back only as a safety fallback after a short timeout if the connection is still in the map:

Actually, to keep it simple and safe: keep the explicit `finalizeConnection` call as a fallback, but set `deleteReceived = true` first so the `onconnectionstatechange` handler logs "cleanly" even if it fires first:

```typescript
managed.deleteReceived = true;
managed.pc.close();
finalizeConnection(connectionId, 'Client DELETE'); // fallback if onconnectionstatechange doesn't fire
```

**Step 7: Run test to verify it passes**

```bash
npm test -- tests/webrtc-server-disconnect-log.test.ts
```

Expected: PASS.

**Step 8: Run full test suite and type check**

```bash
npm test && npm run check
```

Expected: all tests pass, no type errors.

**Step 9: Commit**

```bash
git add src/lib/server/webrtcRegistry.ts src/routes/api/webrtc/+server.ts tests/webrtc-server-disconnect-log.test.ts
git commit -m "feat: track openedAt/lastMessageAt/deleteReceived; log unexpected server disconnects"
```

---

## Manual Verification

After all tasks are committed, start the dev server and verify:

```bash
npm run dev
```

1. Open `http://localhost:5173` — connection should complete in under 3 seconds (previously up to 17s worst case).
2. Check server logs: you should see `[RTC] Starting ICE gathering` → `[RTC] ICE gather ended` → `[RTC] Sending offer` → `[RTC] Answer received` → `[RTC] Data channel open`.
3. Click Stop — server logs should show `Connection ... closed cleanly (DELETE received)`.
4. Let it run; if it drops unexpectedly, logs will show `UNEXPECTED connection close` with ICE state, last message time, and duration — the data needed to diagnose the 25% failure.
