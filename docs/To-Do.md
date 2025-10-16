# To-Do

- Add charts
- Why does it (sometimes) take so long to make a connection
- Display package.json `version` and the git hash somewhere in the GUI
- Consider WebRTC Leak Shield or uBlock’s “Prevent WebRTC IP leak” for testing
- Add elapsed time & Bytes/second or /minute
- Create a Docker container with docker-compose.yml for ease of remote installation
- Install Docker container on atl.richb-hanover.com
- Devise tests to make sure arriving RTCProbes
  are sorted properly and MOS scores are correct

## Done

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

- Add Ctl-C to click the Disconnect button
- Why do I get this when connecting to atl.richb-hanover.com:5173?

  ```text
  Blocked request. This host ("atl.richb-hanover.com") is not allowed.
  To allow this host, add "atl.richb-hanover.com" to `server.allowedHosts` in vite.config.js.
  ```

  _(Because the Vite dev server only expects
  to be running on localhost or 127.0.0.1.
  The `server.allowedHosts` in vite.config.js
  solves it.)_
