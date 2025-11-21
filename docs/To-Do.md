# To-Do

Ideas that have occurred to me. Some might be good ones...

- Add navigator.sendBeacon() to tell the server that the window/connectionID has closed
- Create a deploy-cutie.sh that pulls from repo, issues required build commands, then `npm run preview` (or somesuch)
- Change latency chart Y-axis to 250ms
- If web GUI can't initially make WebRTC connection, error message should be "Can't make WebRTC connection" not "Collection stopped: WebRTC connection failed"
- See **Testing Ideas** below
- Make `npm run build` work
  - Need to understand @sveltejs/adapter-auto, adapter-node, adapter-cloudflare...
- (maybe) Display a spinner centered above the entire page from the time of the Start until it's connected
- Create a Docker container with docker-compose.yml for ease of remote installation
  - Add TURN server capability
  - Probably bundle `coturn` along with Cutie.
    Is it possible to do it in a single container?
    Or does docker-compose.yml do it all?
  - Also add netperf, iperf, iperf3,
    Crusader (client and server)
    to the Docker container
  - Install Docker container on atl.richb-hanover.com
  - Install on some external server site. Can it be free?
- Why does the Start button briefly flash green on page load?
- FF fails to connect to atl.richb-hanover.com after `git pull; npm run dev`
  (Connect gave immediate Connecting... but then
  gave "WebRTC error...".) Subsequent test worked fine.
  Happened again after git pull; immediately reloaded
  and retried worked as expected.
- Move the CSS out of the end of +page.svelte (?)

## Bugs

- `npm run build` then `npm run preview` seem to work, but GUI cannot start a WebRTC connection.
- If server fails, WebRTC connection seems to remain live which causes browser to restart?
- Also other connections aren't released?
- (Same bug?) After running overnight (working or not), coming back to the page on Firefox (other browsers too), the page reloads (starting a new run) instead of displaying the results of the completed test run
- In one test run, Min. MOS was shown as 0.99 (not even possible), chart didn't show it.
- Are the Min and Max values displaying the 10s Averages?
- `nohup npm run dev &` on atl stops accepting WebRTC connections

## Testing ideas

- READ THE CODE!
  - Analyze packet loss, latency, and jitter code
  - Why is "page" deprecated? (+page.svelte, line 3)
  - In sendprobe(), why not latencyStats.totalSent += 1
- How does integrateSamples() work? Does it move samples into mosStore?
- Feed in fake data greater than the max on the chart, and see that it's clipped to the top
- Devise test cases to make sure arriving RTCProbes
  are sorted properly and MOS scores are correct
- Consider testing with WebRTC Leak Shield or uBlock’s “Prevent WebRTC IP leak”

## Done

All these items had been in the "to-do" section, but have been completed:

- Re-cast the entire project in SvelteKit.
  Use `npx sv create WebRTC-SvelteKit` to create.
- Use ChatGPT in VSCode to examine code base and suggest
  how to make the GUI. It's surprisingly good, although I haven't read much of the code.
- Bind to `0.0.0.0` in development mode for Firefox.
  Chrome and Safari are less strict about addresses:
  Use: `npm run dev --host 0.0.0.0 --port 5173`
- Why does Firefox fail to get the second and subsequent RTCProbes
  connecting to 192.168.253.6:5173?
  Chrome and Safari (Edge, Brave, FF Developer edition) seem to work fine.
  _I found a workaround for the original problem (no probe packets returning). I had been changing some of the media.peerconnection.ice... settings. I used Restore Defaults in Firefox, and the client app started working. (Now to restore all my extensions...)_
- Add Ctl-C to click the Disconnect button; Return starts collection.
- Why do I get this when connecting to atl.richb-hanover.com:5173?

```text
Blocked request. This host ("atl.richb-hanover.com") is not allowed.
To allow this host, add "atl.richb-hanover.com" to `server.allowedHosts` in vite.config.js.
```

_(Because the Vite dev server only expects
to be running on localhost or 127.0.0.1.
The `server.allowedHosts` in vite.config.js
solves it.)_

- Add charts
- **Display** the package.json version number and
  (if not a production build)
  and the git commit hash in small text
  at the lower-right corner of the "WebRTC Stability Test" panel.
  The string should be "Version x.x.x &mdash; #xxxxxxxx"-
- Display package.json `version` and the git hash somewhere in the GUI.
  Use `execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();`
- Change buttons to Start/Stop
- Stop collecting after 2 hours
- Why don't dots show up with FF or Safari but do with Chrome?
  Why does it only affect files served from ...142?
  _(Seems to be fixed in #112b3b3)_
- Why do I get: `8:52:46 AM [vite-plugin-svelte] src/lib/components/MosChart.svelte:184:2 Self-closing HTML tags for non-void elements are ambiguous ... _(Fixed several npm run check errors)_
- X-axis time-stamps can be slanted;
  also drop alternate time stamps when they get compressed
- Why does it (sometimes) take so long to make a connection?
  Safari seems fast... FF slow, Chrome - ?
  _(FF waits until all ICE candidates arrive or for 15 seconds. Change the code to return a candidate immediately.)_
- Change label from "Instant" to "Now", add Min, Max columns
- Add Packet Loss chart (#8c4d15) and Latency / Jitter chart (#5959e6 / #2babab)
- Tooltips - point out top or bottom; what is the top number?
- Tint the two-hour timeout and manual stop with green
- Add elapsed time & Bytes/second
- Move charts closer (vertically) so they all can be seen on one screen
- Where does startup code go for the backend? In hooks.server.ts...
- Make the chart legend font even bigger
- Align all chart left and right edges (make them the same width) so that it's easier to line up packet loss & MOS drop by eye
- If latency (or other value) is greater than Y-axis, adjust Y-axis. (Or peg it...)
- Server init code (printing version, etc) should appear first in output
- In the server connected message, include the number of current connections, maybe total connections since start time
