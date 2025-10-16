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
  pending probe map to their defaults, then emits the fresh stats—
  used both on startup and when reusing the monitor.
- `stop` (src/lib/latency-probe.ts:107):
  Calls clearTimers, drops the active channel, preserves the
  existing history array contents, and emits stats so the UI can
  reflect the idle state.
- `recordLostProbes` (src/lib/latency-probe.ts:115):
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
  response, resolves the matching pending probe, updates latency/
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

## MOS (Mean Opinion Score) calculations

The Netbeez article
[Impact of Packet Loss, Jitter, and Latency on VoIP](https://netbeez.net/blog/impact-of-packet-loss-jitter-and-latency-on-voip/)
describes "Mean Opinion Score" (MOS) quality calculations.
Here is an excerpt from their article:

---

The industry has adopted the Mean Opinion Score (MOS)
as the universal metric to measure and classify
the conversation quality that happens over a network.
As the name suggests, it is based on the opinion of the
user and ranges from 1.0 to 5.0
with the following classifications:

MOS Quality Impairment

- 5 Excellent Imperceptible
- 4 Good Perceptible but not annoying
- 3 Fair Slightly annoying
- 2 Poor Annoying
- 1 Bad >Very annoying

Typically, the highest MOS score that can be achieved is 4.5
for the G.711 codec.
The cutoff MOS score for calls that can be tolerated
is around 2.5.
Ideally, the MOS score is calculated by asking the
participants to put a score to the conversation.
However, this is not practical, and there are ways
to estimate the call quality based on the
network’s latency,jitter, and packet loss.

The most popular method is based on the E-model,
which calculates the rating factor, R,
which then is used to derive the MOS score.

For an R-value larger than 93.2, we get the maximum MOS score.
Depending on latency, jitter, and packet loss we need to deduct from 93.2.
This may sound like a magic number,
but if you want to learn more about how it’s derived
and the E-model you can take a look
[here](https://web.archive.org/web/20240401042449/https://scholarworks.gsu.edu/cgi/viewcontent.cgi?article=1043&context=cs_theses)
_(Original is no longer available.
Link above is to Wayback Machine at archive.org)._

###Effective Latency

Latency and jitter are related and get combined into a
metric called effective latency,
which is measured in milliseconds.
The calculation is as follows:

`effective_latency = latency + 2*jitter + 10.0`

We double the effect of jitter because its impact is high
on the voice quality and we add a constant of 10.0 ms
to account for the delay from the codecs.

### Calculating R

As noted above, R starts with a max value of 93.2.
We reduce R based on effective latency as follows:

For effective_latency < 160.0 ms:

`R = 93.2 - (effective_latency)/40.0`

For effective_latency >= 160.0 ms:

`R = 93.2 - (effective_latency - 120.0)/10.0`

If the effective latency is less than 160.0 ms,
the overall impact to the voice quality is moderate.
For larger values, the voice quality drops more significantly,
which is why R is penalized more.

### Packet loss

We take into consideration packet loss
(in percentage points) as follows:

`R = R - 2.5 * packet_loss`

### Final MOS calculation

Finally, we calculate the MOS score using with the following formula:

For R < 0:

`MOS = 1.0`

For 0 < R < 100.0:

`MOS = 1 + 0.035*R + 0.000007*R*(R-60)*(100-R)`

For R >= 100.0:

`MOS = 4.5`
