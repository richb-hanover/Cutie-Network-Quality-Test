# Theory of Operation

## How the VSee Network Stability Test works

The code establishes a connection to an RTC server endpoint and measures the responses.

The original code makes a POST request to
[the VSee server](https://test.vsee.com/network/connections)
and receives a blob of JSON that gives the ID of the
RTC thingie that we could talk to.

This fetch() call fails because of a CORS error. (test.vsee.com is not configured to allow "\*" to connect, only its own pages.)

Making the request manually (in a browser) and pasting the response into
the code moves to the next error message, which is: `WebRTC: ICE failed, add a TURN server and see about:webrtc for more details`

But if we could set up our own server running on `localhost`, or on
`foo.local`, or even on `vseetest.mydomain.com`
to serve the pages and host the RTC server, this could be useful.

I asked ChatGPT to review this code and suggest an RTC server implementation.

Also used [webcrack](https://webcrack.netlify.app/) to break out modules
from the index.js file.
This removed thousands of lines of code
(which were all the bundled dependencies) from the original _index.js_ file.
Webcrack also seems to convert CJS `require()` to `import` statements.
It may also have produced the _package.json_ file.

## rtcClient.js

This code sends a POST `/connections` and
(optionally) receives back credentials to be added
to the `iceservers` array.

## Development Strategies

- Must bind to `0.0.0.0` in development mode for Firefox.
  Chrome and Safari are less strict about addresses:
  Use: `npm run dev --host 0.0.0.0 --port 5173`

## latency-probes.ts

- src/lib/latency-probe.ts:1 defines interval and history constants that control how often probes fire, how long before a ping counts as lost, and how many samples to retain.
- src/lib/latency-probe.ts:7 exports TypeScript types describing latency samples, aggregate stats, and the public LatencyProbe API so other modules get strong typing.
- src/lib/latency-probe.ts:26 `createEmptyLatencyStats()` helper
  resets counters and history to a known baseline.
- src/lib/latency-probe.ts:34 builds `createLatencyProbe()` is the
  main function, wiring configurable timings, timers, and optional
  callbacks for timestamping, clock source, and error logging.
- src/lib/latency-probe.ts:47 tracks outbound pings in pendingPings, keeps running totals, and enforces a max history with appendHistory.
- src/lib/latency-probe.ts:83 implements reset and stop, clearing timers and pending state while emitting fresh stats snapshots.
- src/lib/latency-probe.ts:101 periodically scans pending pings, marks those exceeding lossTimeoutMs as lost, updates totals, and notifies listeners.
- src/lib/latency-probe.ts:119 handles start: stops prior runs, resets stats, kicks off the first probe immediately, then schedules recurring probes and loss checks.
- src/lib/latency-probe.ts:131 crafts each probe message with sequence and timestamp metadata, stores the send time, and increments the sent counter; errors go through the injected logger.
- src/lib/latency-probe.ts:148 parses incoming messages, validates they are latency probes, calculates round-trip latency for known sequences, updates totals and averages, prunes history, and returns true so callers know the payload was handled.
