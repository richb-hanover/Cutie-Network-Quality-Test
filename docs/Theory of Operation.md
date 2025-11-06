# Theory of Operation

## How WebRTC Network Stability Test works

This project uses a WebRTC connection to
send "probe messages" multiple times a second
to a server and use the resulting responses to
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
  Re-initializes counters, jitter estimate, sequence number, and
  pending probe map to their defaults, then emits the fresh stats—
  used both on startup and when reusing the monitor.
- `stop` (src/lib/latency-probe.ts:107):
  Calls clearTimers(), drops the active channel, preserves the
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

## MOS (Mean Opinion Score) calculations

This Netbeez article
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

- 5 Excellent - Imperceptible
- 4 Good - Perceptible but not annoying
- 3 Fair - Slightly annoying
- 2 Poor - Annoying
- 1 Bad - Very annoying

Typically, the highest MOS score that can be achieved
is 4.5 for the G.711 codec.
The cutoff MOS score for calls that can be tolerated
is around 2.5.
Ideally, the MOS score is calculated by asking the
participants to put a score to the conversation.
However, this is not practical, and there are ways
to estimate the call quality based on the
network’s latency, jitter, and packet loss.

The most popular method is based on the E-model,
which calculates the rating factor, R,
which then is used to derive the MOS score.

For an R-value larger than 93.2, we get the maximum MOS score.
Depending on latency, jitter, and packet loss we need to deduct from 93.2.
This may sound like a magic number,
but if you want to learn more about how it’s derived
and the E-model you can take a look at
[An Analysis of the MOS...](https://web.archive.org/web/20240401042449/https://scholarworks.gsu.edu/cgi/viewcontent.cgi?article=1043&context=cs_theses).
_(Original is no longer available.
Link above is to a Wayback Machine copy at archive.org)._

### Effective Latency

Latency and jitter are related and get combined into a
metric called effective latency,
which is measured in milliseconds.
The calculation is as follows:

`effective_latency = latency + 2*jitter + 10.0`

We double the effect of jitter because its impact is high
on the voice quality and we add a constant of 10.0 ms
to account for the delay from the codecs.

### Calculating R

As noted above, R (the "rating factor")
starts with a max value of 93.2.
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

## Provenance - "Vibe Engineering"

This is a completely new implementation
using SvelteKit, ChatGPT, and native network knowledge.
The project was inspired by the WebRTC capabilities of
[VSee Network Stability Test](https://test.vsee.com/network/index.html).

I am warming to the term
[Vibe Engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/)
as described by Simon Willison to create
the application "from scratch".
Specifically, I added the
[Codex](https://developers.openai.com/codex/ide/)
extension to VS Code,
opened the code's folder in the project, and began making requests.
Codex reviews the current state of the code in the folder,
and automatically modifies and creates new code
in response to those requests.

After I used `npx vs WebRTC-Stability-Test` to
create a new SvelteKit project,
this is the general flow of the prompts I gave
to ChatGPT/Codex in VSCode:

- start a WebRTC listener on the server
- serve out a GUI that would establish a WebRTC connection
- send messages to the server and display the responses.
- After that was working, I manually tweaked the server
  code to echo back each received message.
- Someplace along the line, I also asked for some statistics
  in the GUI, including calculating the packet loss,
  latency, and jitter
- I also asked ChatGPT to implement the client "probe message"
  facility, factoring it into _latency-probes.ts_

Once that was working, I asked ChatGPT to
create a chart for the MOS value.
(I had to tweak the MOS formula manually.)
I spent a lot of time tuning up the appearance
of the chart -
getting the Y axis labels and
the time stamps on the X-axis right;
ensuring proper behavior for stopping the test;
and its general size and appearance.

After the (single) MOS chart was working well,
I asked ChatGPT to clone the first chart
to make one for packet loss
and another for latency & jitter.

After that, the GUI came together with general
fussing and nudging, mostly with prompts to ChatGPT.

**The process worked surprisingly well.**
I am especially impressed by the small amount
of manual work I needed to do.
Some thoughts:

- Even though I didn't do it, I probably could have asked
  ChatGPT to generate the SvelteKit project on its own.
  I chose SvelteKit because I wanted to experiment with
  that tool set.
  (So far, I haven't needed to touch _any_
  SvelteKit specific code. Alas.)
- I was astonished that the web GUI code worked as well
  as it did right out of the box.
  It displayed all the stats requested,
  grouped in a logical format.
  It also looked good both on desktop (wide) and
  phone (narrow) screens without instructions.
  (That may be a basic SvelteKit capability,
  but the ChatGPT code "just fit right in".)
- As part of the initial prompt, I asked ChatGPT
  to "compute MOS score".
  The code it created was close, but not exactly correct.
  I updated it manually.
- I also edited the "hero text" at the top of the web GUI.
  It was far simpler than telling ChatGPT to change the
  wording there... (And I could iterate much faster.)

- When I asked ChatGPT to add the other two charts,
  it created two more source files with essentially
  identical code. They worked fine.
- But when I asked for further modifications to the charts,
  it had to modify three files.
  So I asked ChatGPT to factor out the common charting code and
  it was very successful, and needed no further fussing.

- ChatGPT "understands" (that is, does the "right thing")
  with imprecise requests.
  I asked it to display elapsed time, and it chose a format of
  `##s`, then `##m ##s` without my instruction.

Will I ever "just start hacking code" again? I don't think so.
