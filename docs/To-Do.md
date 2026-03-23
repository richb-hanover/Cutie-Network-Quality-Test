# To-Do

Ideas that have occurred to me. Some might be good ones...

## Features

- GUI changes
  - Remove "Return" to start and Cmd-. to stop collection
  - Move Save/Reload buttons inside the Message Log panel
  - Force all figures (all ms readings?) in the LatencyMonitor panel
    to be at least xxx.xx wide without change.
  - Drop reliance on USParser.js; remove mention in license
- Why do many (not anywhere near all) sessions stop about 1h 20-30m?
- Change client to detect changes & stop test when
  laptop lid closes, session saved, etc and put up appropriate error
- Change server code to observe navigator.sendBeacon()
  messages that the window/connectionID has closed/changed/etc.
- Aggregate the traffic volume of latency probes
  received & sent plus a measure of traffic rate
  and add to `/api/stats`
- Figure out how to better discourage frequent flyers/abusers
- See **Testing Ideas** below

## Hosting

- Use [Caddy reverse proxy?](https://caddyserver.com/docs/quick-starts/reverse-proxy) for HTTPS server?
- Set up cutie.bufferbloat.net to redirect to port 4173
  (Or set up cutie.bufferbloat.net to serve out
  its own domain name from the `dist` directory using Apache)
- Create a Docker container with _docker-compose.yml_
  for ease of remote installation
  - Add TURN server capability.
    Maybe bundle `coturn`.
    Is it possible to do it in a single container?
  - Also add netperf, iperf, iperf3,
    Crusader (client and server)
    to the Docker container
  - Install Docker container on atl.richb-hanover.com
  - Install on some external server site. Can it be free?

## Bugs

- Why do some oldConnections on the server end with "failed / complete"?
- Why do Android tablets seem to take longer to establish connections?
- Why are dots sometimes spaced out when the browser tab is in the background?

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
- What does Percent loss chart show? Instantaneous?
  (What would that mean?)
  10-second? (Would have 100 samples in 10 seconds...)

## Done

All these items started life in the "to-do" section, but have been completed:

- Re-cast the entire project in SvelteKit.
  Use `npx sv create WebRTC-SvelteKit` to create.
- Use ChatGPT in VSCode to examine code base and suggest
  how to make the GUI. It's surprisingly good, although I haven't read much of the code.
- Bind to `0.0.0.0` in development mode for Firefox.
  Chrome and Safari are less strict about addresses:
  Use: `npm run dev --host 0.0.0.0 --port 5173`
  (Same for preview mode)
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
  (if not a production build) the git commit hash in small text
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
- Add `/api/stats` to display current stats
- Create a deploy-cutie.sh that pulls from repo, issues required build commands, then `npm run preview` (or somesuch)
- Make `npm run build` work
  - Need to understand @sveltejs/adapter-auto, adapter-node, adapter-cloudflare...
- ~~If server fails, WebRTC connection seems to remain live which causes browser to restart?~~ This is likely due to npm run dev automagically restarting web sessions
- `npm run build` then `npm run preview` seem to work, but GUI cannot start a WebRTC connection.
- Also other connections aren't released?
- (Same bug?) After running overnight (working or not), coming back to the page on Firefox (other browsers too), the page reloads (starting a new run) instead of displaying the results of the completed test run
- Change latency chart Y-axis to 250ms
- If web GUI can't initially make WebRTC connection, error message should be "Can't make WebRTC connection" not "Collection stopped: WebRTC connection failed"
- (maybe) Display a spinner centered above the entire page from the time of the Start until it's connected ~~Not needed since it connects quicker~~
- Why does the Start button briefly flash green on page load?
- FF fails to connect to atl.richb-hanover.com after `git pull; npm run dev`
  (Connect gave immediate Connecting... but then
  gave "WebRTC error...".) Subsequent test worked fine.
  Happened again after git pull; immediately reloaded
  and retried worked as expected.
- Move the CSS out of the end of +page.svelte (?)
- Fix "page" in _+page.svelte_, line 4
- _Bug Bankruptcy follows_
- In one test run, Min. MOS was shown as 0.99 (not even possible), chart didn't show it.
- Are the Min and Max values displaying the 10s Averages?
- `nohup npm run dev &` on atl stops accepting WebRTC connections
- Screenshot from DH - in 3K waiting room. First "outage" was from running betterspeedtest.sh from my computer. Second was with my computer idle
- Loss of connection should not say "Data channel closed" (SB something like "Lost connection to other end")
- Change to "End Time / Elapsed Time"
- Move "Message" to the Message Log panel; then remove remainder of Connection panel
- Clicking Start should clear all accumulated stats
- Change Long-term Stats to show Start time as ~~dd/mm/yyyy~~ hh:mm:ss (see below)  
  and Elapsed Time / End Time Time as ?m ?s / ~~dd/mm/yyyy~~ hh:mm:ss
- Catch Ctl/Cmd-S and save the current readings in local file - xxx.cutie
  - Stop the data collection
  - This becomes the source data for a test data set
- WebGUI should become a drag target for a saved cutie readings file;
  - Restore the values from the file
  - Replay the saved latency probe values into the chart
  - Do not connect to the Cutie backend
- ~~Email/save results of a test before restarting/reloading~~
  No - just save and reload session file
- Make all dates in the format yyyy-mm-dd
- Drop Cloudflare adapter for SvelteKit because of vulnerability
  and the fact that we're not using it
