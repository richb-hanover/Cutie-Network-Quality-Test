# To-Do

- Add Packet Loss chart (#8c4d15) and Latency / Jitter chart (#5959e6 / #2babab)
- Consider WebRTC Leak Shield or uBlock’s “Prevent WebRTC IP leak” for testing
- Add elapsed time & Bytes/second or /minute
- Create a Docker container with docker-compose.yml for ease of remote installation
- Install Docker container on atl.richb-hanover.com
- Devise tests to make sure arriving RTCProbes
  are sorted properly and MOS scores are correct
- Why does the Start button briefly flash green on page load?
- One-out-of-one failure: FF connecting to atl;
  Connect gave near immediate Connecting... but then
  gave "WebRTC error...". Subsequent test worked fine.
  Happened again when I got the failure; immediately reloaded
  and retried worked as expected.

## Done

All these items were in the "to-do" section, but have been completed:

- Re-cast the entire project in SvelteKit.
  Use `npx sv create WebRTC-SvelteKit` to create.
- Use ChatGPT in VSCode to examine code base and suggest
  how to make the GUI. It's surprisingly good, although I haven't read much of the code.
- Bind to `0.0.0.0` in development mode for Firefox.
  Chrome and Safari are less strict about addresses:
  Use: `npm run dev --host 0.0.0.0 --port 5173`
- Why does Firefox fail to get the second and subsequent RPCProbes
  connecting to 192.168.253.6:5173?
  Chrome and Safari (Edge, Brave, FF Developer edition) seem to work fine.
  _I found a workaround for the original problem (no probe packets returning). I had been changing some of the media.peerconnection.ice... settings. I used Restore Defaults, and the client app started working. (Now to restore all my extensions...)_

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
- Stop collecting at 2 hours
- Why don't dots show up with FF or Safari but do with Chrome?
  Why does it only affect files served from ...142?
  _(Seems to be fixed in #112b3b3)_
- Why do I get: `8:52:46 AM [vite-plugin-svelte] src/lib/components/MosChart.svelte:184:2 Self-closing HTML tags for non-void elements are ambiguous — use `<canvas ...></canvas>`rather than`<canvas ... />`
https://svelte.dev/e/element_invalid_self_closing_tag`
  _(Fixed several `npm run check` errors)_
- X-axis time-stamps can be slanted;
  also drop alternate time stamps when they get compressed
- Why does it (sometimes) take so long to make a connection?
  Safari seems fast... FF slow, Chrome - ?
  _(FF waits until all ICE candidates arrive or for 15 seconds. Change the code to return a candidate immediately.)_
- Change label from "Instant" to "Now", add Min, Max columns
