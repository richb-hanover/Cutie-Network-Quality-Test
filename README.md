# WebRTC Network Stability Test

Measure the quality of the network by sending short packets
to a backend server and analyze the resulting
packet loss, and latency and jitter values
to produce charts of the performance of the network.

Start this test before beginning a phone or videoconference.
If there are problems (freezing, distorted sound,
"unstable network" messages, etc),
flip to the WebRTC Network Stability Test to see if the
impairments are on your end, or someone else's.

This test creates a WebRTC stream from your computer
back to the source of the Web GUI.
It continually sends (10 probes per second) small messages
to the backend which echoes them back.
This allows the GUI to compute packet loss, latency, and jitter.
