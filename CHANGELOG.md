# CHANGELOG

## Unreleased

---

## Version 0.2.23 - 2026-03-09

- Adding Cmd/Ctl-S to save data; then reload by drag and drop
- Or use Save / Reload Session buttons
- Update README to show new screen shot with improved narrative
- Bump version to 02.23

## Version 0.2.22 - 2026-03-08

- Remove untested code designed to collect samples to produce test data set
- Fixed new bug where stats never were added to 10_sec values and not charted
- Bump version to 0.2.22

## Version 0.2.20 - 2026-03-07

- Use obra/superpowers to re-engineer the WebRTC connection logic.
  May solve the problem of random disconnections.
- Add design documentation in _docs/plans_
- Reduce ICE timeout from 15 seconds to 5 seconds (1.5 seconds is too short,
  and frequently fails to connect)
- Improve logging of disconnect reasons for troubleshooting
- Remove stray console.log() in favor of logger.info()
- Bump version to 0.2.20 (0.2.19 not published)

## Version 0.2.18 - 2026-02-24

- Start/Stop/Connecting and About buttons are now side-by-side
- Change Packet loss chart color to be orange-like (#6b7280)
- Adjust Long-term Statistics to display
  Start Time (date & time) on the first line,
  then End Time / Elapsed Time on the second,
  where End time is "-" while the connection is active.
- Block certain client IP addresses
- Right-justify values in the Latency Monitor panel
- Move message sending to the Message Log panel
- Remove the Connection panel because its information
  was redundant/confusing
- Bump version to 0.2.18

## Version 0.2.16 - 2026-02-13

- Simplified GUI to have one Start/Connecting/Stop button
- Added About button and a modal window to explain the program;
  shortened text in the main page.
- Tightened up the Latency Monitor statistics to look better
  in narrow windows
- Changed Long-term stats to have "Start / Elapsed Time" and
  "End time" stats;
- Fixed Svelte 4 holdover for "page"; hold off on full Svelte 5 refactor
- Add ConnectionID to initial Welcome message
- Improved logging for disconnects, etc.
- Bump version to 0.2.16

## Version 0.2.15 - 2026-02-09

- Much work on improved WebRTC connection establishment
- Worked around Firefox peculiarities (Thanks, Claude)
- Updated npm dependencies; ran audit fix
- Bumped version to 0.2.15 (interim versions not released)
- Deploying to production

## Version 0.2.12 - 2025-12-14

- Add `connectionId` to the beacon where available
  so the server logs can see what's happening when
  there are transitions on the client
- Server log any message sent from the GUI in addition
  to echoing it
- Bump version to 0.2.12 (0.2.11 not released)

## Version 0.2.10 - 2025-12-13

- Improved logging surrounding connection start/end; removed redundant logger.info() & console.log()
- Add "reason" code to `/api/stats`
- Set fixed-width fields for ms values in Latency Monitor panel
- Add new API `/api/beacon` that is triggered when the client changes, shows/hides, etc.
  the Cutie tab; triggered by _lifecycle-beacon.ts_
- More documentation/comments for `api/webrtc`
- Slightly tuned up _deploy.sh_ script
- Bump version to 0.2.10

## Version 0.2.9 - 2025-12-03

- Improve _deploy.sh_. It now removes all but the 10
  most recent log files from _logs/_,
  checks and kills previous Cutie instances, and
  logs all the steps of the install/build process.

## Version 0.2.8 - 2025-12-02

- Updated `api/stats` to display ConnectionID,
  connection start time and duration
- Also display the 10 most recent ConnectionIDs
  with their stats to see how they perform

## Version 0.2.7 - 2025-12-02

- Update _deploy.sh_ to run `npm run preview`
  (instead of `npm run dev` on the remote host)
- Deploy script forces port 5173 for stability for other testers
- Fixed link to Provenence in _Theory of Operation_
- Added a couple test cases to _To Do_

## Version 0.2.6 - 2025-11-21

- Add `/api/stats` to return runtime stats
- Added `beforeUnload` listener to drop connection before browser window closes/reloads
- Factor _+page.svelte_ to move all the WebRTC functions to _webrtc.ts_
- Server startup message includes LOG_LEVEL
- Add _deploy.sh_ script to deploy the app on the production host
- Fix lint errors in _NetworkHistoryChart.svelte_
- Much more logging (using `logger`) to understand loss of connection or possible OOM
- Switched to `@sveltejs/adapter-node` to make `npm run preview` run on production host
- Moved Blueberry Hill Software _favicon.ico_ to _/static_
- Bump version to 0.2.6 (skipped 0.2.5)

## Version 0.2.4 - 2025-11-03

- Align left edges of all three charts
  so time stamps all line up vertically.
- Make all labels for the axes bold
- Move startup/logging code to hooks.server.ts
- Bump version to 0.2.4

## Version 0.2.3 - 2025-11-03

- Bump to version 0.2.3 (Version 0.2.2 not released)
- Even more logging to detect interesting HTTP and WebRTC events
- Editorial pass on To-Do.md and home page (add link to Github repo)
- Add MIT License, with a note that Cutie also includes
  a PRO Personal license to UAParser.js
- Switch date display from UTC to locale

## Version 0.2.1 - 2025-10-27

- Added logging on server to detect failing WebRTC

## Version 0.2.0 - 2025-10-26

- Changed name to Cutie Network Quality Test ("QT" - get it?)
- Factored out the "chart code" so that it lives in one file
- Pin chart points to the max of the chart;
  tooltip shows the correct value
- Change Statistics panel to show:
  Start time, Elapsed Time, Bytes Transferred, Bytes/second, Round Trip Time
- Display the ConnectionID in the
  Server object message at the bottom
- Bump version to 0.2.0

## Version 0.1.0 - 2025-10-17

- Created charts for all variables:
  MOS, Packet Loss, and Latency&Jitter
- mosStore.ts saves all four statistics in
  one time-stamped object
- Moved all charts into a single panel
- Fixed the MOS chart to run from
  1.0 (Bad) to 4.5 (Excellent)
- Fixed all the `npm run check` and
  `npm run lint` errors
- _Dockerfile still does not work_
- This is good enough to criticize...

## Version 0.0.4 - 2025-10-17

- Adjust chart to preserve starting time at the origin

## Version 0.0.3 - 2025-10-17

- Better charts: fixed time stamps
- Chart test routine: add `?chartTest=1` to the URL
- Runs for max of two hours, then auto-stops
- Fixed delay of connection for Firefox
  (returns first ICE instead of waiting for all to arrive
  or timing out after 15 seconds)
- Created new README; moved old to DEVELOPMENT.md
- Created this CHANGELOG
- Bump version to 0.0.3

## Version 0.0.2 - 2025-10-16

- Basic functionality:
- Start an RTC connection to local backend server
  and send Latency Probes
  containing a sequence number and current time
  every 100 msec (10 probes/second).
- RTC Server echoes back the latency probes
- The client can use those returned latency probes
  to summarize latency, jitter, and packet loss both
  instantaneous and "averaged over the last 10 seconds"
- Those "10-second" values are charted.
  The first chart is MOS Quality
  (which is pretty boring on my local network) because
  it's low latency and jitter and near zero packet loss
- Two more charts to come: a packet loss chart,
  and latency/jitter both in the same chart
  All three charts will be slaved to the same time scale.
- Runs only for two hours, then auto-stops
- Also stops after clicking Stop, or an error occurs,
  such as no latency probes for a while.
- Much diagnostic/troubleshooting/test GUI elements remain
