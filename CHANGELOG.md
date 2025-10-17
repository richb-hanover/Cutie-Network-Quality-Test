# CHANGELOG

## Unreleased

---

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
