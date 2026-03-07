# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build
npm run preview      # Run production build locally

npm run check        # Svelte type checking (run before committing)
npm run lint         # Prettier + ESLint check (run before committing)
npm run format       # Auto-format with Prettier
npm test             # Run Vitest unit tests
```

Before committing: run `npm run check` and `npm run lint` and ensure no errors or warnings.

## Architecture

Cutie is a SvelteKit full-stack app that measures network quality (latency, jitter, packet loss) using WebRTC data channels. The browser and the Node.js backend form a WebRTC peer connection; the client sends 10 probes/second and the server immediately echoes them back.

### Data Flow

1. **`/api/webrtc` (POST)** — SDP offer/answer negotiation; creates server-side `RTCPeerConnection` via `@roamhq/wrtc`
2. **`src/lib/rtc-client.ts`** — Client-side WebRTC connection setup; normalizes `.local`/`localhost` ICE candidates to `127.0.0.1`
3. **`src/lib/latency-probe.ts`** — Sends `{ type: "latency-probe", seq, sentAt }` every 100 ms; detects lost probes (no echo within 2 s); computes per-probe latency and exponential-average jitter
4. **`src/lib/webrtc.ts`** — Central Svelte store for connection state, latency stats, and session lifecycle (auto-disconnects after 2 hours)
5. **`src/lib/stores/mosStore.ts`** — Converts latency/jitter/loss into MOS scores (1.0–4.5) and 10-second rolling averages that feed the three charts
6. **`src/routes/+page.svelte`** — Main UI: three Chart.js charts, Start/Stop button, About modal, Latency Monitor panel, long-term stats

### Key Algorithms

- **Jitter**: exponential moving average of |currentLatency − previousLatency|, smoothed by dividing by 16
- **Packet loss**: probes not echoed within 2 s are marked lost; `loss% = totalLost / (totalLost + totalReceived) * 100`
- **MOS**: ITU-T G.107-based calculation combining latency, jitter, and packet loss; 4.5 = excellent, 1.0 = bad

### Server-Side WebRTC

`src/lib/server/webrtcRegistry.ts` tracks open `RTCPeerConnection` instances. The server echoes every message it receives back over the data channel. Stale connections are timed out.

## Debugging

- `?chartTest=1` — injects synthetic test data into the charts
- `?createData=1` — records probe data and downloads as CSV
- `GET /api/stats` — returns current running statistics
- Log level: `LOG_LEVEL` / `VITE_LOG_LEVEL` env vars
- Keyboard: `Enter` starts, `Ctrl+C` stops
