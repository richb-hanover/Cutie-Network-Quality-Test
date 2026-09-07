# Design: "Initializing…" button state

## Problem

The Start button currently goes `Start` → `Connecting…` → `Stop` as soon as the
WebRTC peer connection reaches `connected`. But the charts have no data to show
yet at that point — the first chart-worthy data doesn't exist until enough
latency probes have echoed back. Users see "Stop" while the charts are still
empty.

## Design

Add an "Initializing…" state between "Connecting…" and "Stop":

`Start` → `Connecting…` → `Initializing…` → `Stop`

- **Connecting…**: existing state, unchanged (`isConnecting === true`).
- **Initializing…**: `connectionState === 'connected'` and
  `latencyStats.totalReceived < 100`. The peer connection is up but fewer
  than 100 probes (10 seconds at 100ms/probe) have been echoed back.
- **Stop**: `connectionState === 'connected'` and
  `latencyStats.totalReceived >= 100`.

The threshold counts successfully-received echoes, not wall-clock time. Under
packet loss, reaching 100 received samples takes a bit longer than 10 real
seconds — that's intentional, since the button should reflect actual data
availability, not elapsed time.

During "Initializing…" the button is disabled (not wired to `disconnect()`),
matching today's disabled "Connecting…" behavior — clicking it can't
re-trigger `connectToServer()` mid-setup. This means the mouse has no way to
abort during Initializing; `Ctrl+C` remains available as the keyboard escape
hatch (`src/routes/+page.svelte` already handles this independently of button
state). This is a deliberate choice to keep the state machine simple and
consistent with the existing Connecting behavior, not an oversight.

The 100-sample threshold is extracted as a named constant
(`INITIALIZING_SAMPLE_THRESHOLD`) alongside `LATENCY_INTERVAL_MS` in
[`src/lib/latency-probe.ts`](../../../src/lib/latency-probe.ts), and imported
into [`src/routes/+page.svelte`](../../../src/routes/+page.svelte).

## Implementation sketch

`src/routes/+page.svelte`, button markup (around line 258):

```svelte
{#if connectionState === 'connected' && latencyStats.totalReceived >= INITIALIZING_SAMPLE_THRESHOLD}
  <button on:click={() => disconnect('manual')}>Stop</button>
{:else}
  <button on:click={connectToServer} disabled={isConnecting || connectionState === 'connected'}>
    {#if connectionState === 'connected'}
      Initializing…
    {:else if isConnecting}
      Connecting…
    {:else}
      Start
    {/if}
  </button>
{/if}
```

No new store fields are needed — `connectionState` and `latencyStats` are
already tracked in `webrtcState` and already imported into `+page.svelte`.

## Testing

- Manual: start a session, observe `Start` → `Connecting…` →
  `Initializing…` → `Stop` sequence in the browser.
- No new unit tests planned — this is a template-only conditional change with
  no new business logic; existing `latencyStats`/`connectionState` behavior is
  already covered.

## Out of scope

- No change to when charts actually render/plot data (`mosStore.ts` tick
  logic is untouched).
- No change to disconnect/reset behavior.
