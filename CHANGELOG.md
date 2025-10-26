# CHANGELOG

## Unreleased

- Changed name to Cutie Network Quality Test ("QT" - get it?)
- Change Statistics panel to show:
  Start time, Elapsed Time, Bytes Transferred, Bytes/second, Round Trip Time

---

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
