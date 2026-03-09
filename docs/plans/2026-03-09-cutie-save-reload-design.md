# Cutie Save / Reload Feature

**Date:** 2026-03-09
**Status:** Approved

## Overview

Add Save and Reload to Cutie. Save writes the current session to a `.cutie` file in Downloads. Reload reads a `.cutie` file and reconstitutes the window state without establishing a WebRTC connection.

## File Format

Text file, UTF-8. Header lines prefixed with `#`, followed by a CSV section of raw probe data.

```
# cutie v0.2.21
# session-start: 2026-03-09T08:30:00.000Z
# connection-id: abc-123
# duration-ms: 7200000
#
# [latency-monitor]
# mos-instant=4.2,mos-avg=4.1,mos-min=3.8,mos-max=4.4
# latency-ms=28.3,latency-avg=31.2,latency-min=18.0,latency-max=210.0
# jitter-ms=2.1,jitter-min=0.4,jitter-max=18.7
# packet-loss=0.07,loss-min=0.0,loss-max=2.3
#
# [long-term-stats]
# total-sent=72000,total-received=71950,total-lost=50
# bytes-sent=1048576,elapsed-ms=7200000
#
seq,sentAt,receivedAt
0,1741234567890,1741234567932
1,1741234567990,1741234568031
2,1741234568090,
```

- `receivedAt` is empty for lost probes
- All timestamps are Unix milliseconds
- A 2-hour session produces ~72,000 probe rows ≈ 2.5 MB

## Probe Accumulation

The existing in-memory history is capped at 1,000 entries. A new accumulation buffer in `webrtc.ts` collects every raw probe (`seq`, `sentAt`, `receivedAt | null`) for the full session duration. This requires `sentAt` and `receivedAt` to be added to `LatencySample` (or captured via a new callback) so lost probes are also recorded.

## Save Behavior

- **Trigger:** Save button click, or Cmd/Ctrl-S
- If a live session is running, Stop is called first, then the file is written
- If data is present but collection has already stopped, the file is written immediately
- Save is disabled when there is no session data
- File is written to Downloads via a synthetic `<a download>` + `Blob` URL (no server involvement)
- Filename: `Cutie_Results-YYYY-MM-DD-HH-MM-SS.cutie` using the session start time in local time

## Reload Behavior

- **Triggers:** Reload button (opens `<input type="file" accept=".cutie">` picker), or drag-and-drop a `.cutie` file anywhere on the window
- If a live session is running, it is stopped first
- Current session state is cleared
- Panel values (Latency Monitor, Long-term Stats) are set directly from the file headers — no recomputation
- Raw probe rows are fed through the existing `ingestLatencySamples` pipeline to populate the charts; `timestampMs` is normalized relative to the first probe's `sentAt`
- Messages panel shows one synthetic entry:
  `{"type": "Reloaded", "sessionStart": "...", "connectionId": "...", "durationMs": ...}`
- Reload is available at any time

## UI

- Save and Reload buttons in a new row below the Message Log, left-aligned with existing button style
- Save button is disabled (grayed out) when no session data is present
- Drag-and-drop: entire window is the drop target; visual highlight while a `.cutie` file is dragged over; non-`.cutie` drops are ignored
- No other UI changes — Start/Stop, panels, and charts are unchanged in both live and reloaded states

## Success Criteria

- Cmd/Ctrl-S and Save button write a valid `.cutie` file to Downloads
- Reload button and drag-and-drop load a `.cutie` file and reconstitute the window
- Panel values on reload are identical to those at save time
- Charts on reload are visually indistinguishable from the originals
- A 2-hour session file is ≤ 3 MB
- No WebRTC connection is made during reload
