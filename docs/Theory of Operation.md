# Theory of Operation

## How WebRTC Network Stability Test works

This project uses a WebRTC connection to
send "probe messages" multiple times a second
to a server and use the resulting data to
measure latency, jitter, and packet loss.

Specifically, the client inserts
a timestamp and sequence number into its "probe" messages.
The server is configured to echo those probe messages
back to the client.
By comparing the data in the probe message
to the current time and sequence number,
the client can then derive a fine-grained measurement of
latency, jitter, and packet loss.

## latency-probes.ts

This is the heart of the measurement process:

- `createEmptyLatencyStats` (src/lib/latency-probe.ts:43):
  Builds the baseline LatencyStats object with all numeric fields
  nulled or zeroed and an empty history, giving the monitor a
  clean slate to mutate.
- `createLatencyMonitor` (src/lib/latency-probe.ts:55):
  Factory that wires together timers, state, and callbacks for
  probing latency over a data channel; configures defaults for
  cadence, loss detection, clock sources (now), timestamp
  formatting, and logging, and returns the public monitor API.
- `appendHistory` (src/lib/latency-probe.ts:77):
  Keeps the rolling history capped to the requested historySize
  by merging new samples with prior ones and trimming the oldest
  entries.
- `emitStats` (src/lib/latency-probe.ts:82):
  Pushes the current latencyStats snapshot to the optional
  onStats callback whenever state changes.
- `clearTimers` (src/lib/latency-probe.ts:86):
  Cancels the active send and loss-detection intervals and nulls
  their handles so the monitor stops scheduling work.
- `reset` (src/lib/latency-probe.ts:97):
  Reinitializes counters, jitter estimate, sequence number, and
  pending ping map to their defaults, then emits the fresh stats—
  used both on startup and when reusing the monitor.
- `stop` (src/lib/latency-probe.ts:107):
  Calls clearTimers, drops the active channel, preserves the
  existing history array contents, and emits stats so the UI can
  reflect the idle state.
- `recordLostPings` (src/lib/latency-probe.ts:115):
  Scans outstanding probes for ones older than the loss timeout,
  marks them as lost samples, updates totals/history, and emits
  stats; keeps the pending map pruned.
- `start` (src/lib/latency-probe.ts:149):
  Public entry point that ensures a clean state, binds the given
  RTCDataChannel, seeds an immediate probe, and schedules
  periodic sending plus loss checks.
- `sendProbe` (src/lib/latency-probe.ts:159):
  Inner helper that verifies channel readiness, serializes a
  latency probe payload, sends it, tracks the send time for later
  RTT calculation, and increments the sent counter, logging
  errors if transmission fails.
- `handleMessage` (src/lib/latency-probe.ts:194):
  Parses inbound JSON, validates that it’s a latency-probe
  response, resolves the matching pending ping, updates latency/
  jitter aggregates and history, and emits refreshed stats;
  returns whether the payload was recognized.
- `getStats` (src/lib/latency-probe.ts:262):
  Arrow function exposed in the returned monitor that simply
  hands back the latest latencyStats snapshot for consumers.

## Provenance

This is a completely new implementation of the concept above
using SvelteKit, ChatGPT, and native network knowledge.
The project was inspired by the WebRTC capabilities of
[VSee Network Stability Test](https://test.vsee.com/network/index.html).

The structure of this SvelteKit project came from creating
a new SvelteKit project with `npx vs WebRTC-Stability-Test`.
I then asked ChatGPT (in VSCode) to create an app
using this file layout that would:

- start a WebRTC listener on the server
- serve out a GUI that would establish a WebRTC connection
- send messages to the server and display the responses.
- Someplace along the line, I also asked for some statistics
  in the GUI.
- After that was working, I manually tweaked the server
  code to echo back any received message.
- I also asked ChatGPT to implement the client "probe message"
  facility, factoring it into _latency-probes.ts_

After that, it's just general fussing with the features/GUI.
