# Cutie - Network Quality Test

The Cutie test measures the quality of the network
by establishing a WebRTC connection to its backend server
and sending short messages containing
a sequence number and timestamp.
The backend echoes those packets, so the GUI can measure
latency, jitter, and packet loss to
produce charts of the performance of the network.
See the screen shot below:

<img src="./docs/images/Cutie-screenshot.png" width="80%">

As shown in the screen shots,
the user instructions are straightforward:

> Open this page before beginning a call or videoconference
> and let it run in the background.
> Cutie detects intervals of high packet loss, latency and jitter
> that impair the quality and stability of the network.
> The test runs for at most two hours,
> and consumes a bit of bandwidth,
> under two kilobytes per second.

Cutie's WebRTC connection sends 10 probes per second,
(every 100 ms) to produce fine-grained measurements.
The three charts display the 10-second average of
the values below:

- **Network Quality (MOS)**. The
  [Mean Opinion Score](./docs/Theory%20of%20Operation.md#mos-mean-opinion-score-calculations)
  is an industry standard that expresses the quality of a voice call
  (and by extension, of a videoconference call).
  The MOS calculation produces values between
  4.5 (excellent) and 1.0 (bad)
  from the packet loss, latency, and jitter measurements.

- **Packet Loss (%)** Cutie determines packet loss by detecting
  missing sequence numbers from the stream of echoed messages.

- **Latency & Jitter** Cutie computes the difference between
  time the message was received and the timestamp within the message
  to determine the latency for each message.
  It computes the jitter from the differences between
  arrival times of subsequent messages.

## Demo site

You can try Cutie from the test at the
demo site at [http://netperf.bufferbloat.net:5173](http://netperf.bufferbloat.net:5173)

Notes:

- The base ICMP ping time to that site is about 30 ms
  (it's a pretty slow VPS).
  Consequently, Cutie's lowest latency tends to be above 30 ms.
- You could also install a Cutie server on a local computer
  to test your local network's abilities.

## Development and Testing

It is straightforward to install this code on Linux or macOS:

```bash
git clone https://github.com/richb-hanover/Cutie-network-Quality-Test.git
cd Cutie-network-Quality-Test
npm install
```

To run the code:

```bash
# to test from localhost:5173
npm run dev

# To leave a test server running
nohup npm run dev &

```

As noted in the [Theory of Operation](./docs/Theory%20of%20Operation.md),
this was developed in VSCode with the Codex LLM plugin.

## Known bugs

- Sometimes, Cutie fails to connect to the backend.
  Refreshing the page typically solves the problem.
  Please let me know in the Issues if this problem bites you.
- Cutie currently relies on being able to create a WebRTC
  connection between the GUI and the backend.
  It seems to work with single NAT.
  Multiple NATs will require a TURN server.
- I envision bundling `coturn` in a Docker container
  at some point to create a turnkey server
  along with netperf, iperf, iperf3, Crusader server, etc.
  This container could run on something small
  (like a Raspberry Pi 4)
  that could be dropped onto a network anywhere
  and used as a test platform.
- There are occasional surprises (errors) in the reported numbers
  as compared to values recorded in the charts.

## What's with the name "Cutie"?

It's a vaguely humorous pronunciation (for English speakers)
of "QT" for "Quality Test".
A saving grace is that "Cutie" seems not to have collisions
in a quick Google search for "cutie network test".

## Questions & Feedback

This is version 0.2.1, and is early, alpha-quality code.
Read the
[Provenance - Vibe Engineering](.docs/Theory%20of%20Operation.md#provenance---vibe-engineering)
information to see how this was derived.

I would be pleased to get feedback or bug reports on the
[Issues](https://github.com/richb-hanover/Cutie-network-Quality-Test/issues)
page.
