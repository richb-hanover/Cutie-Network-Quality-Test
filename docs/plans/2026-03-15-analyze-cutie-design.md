# Design: `analyze-cutie` Script

**Date:** 2026-03-15

## Overview

A standalone TypeScript script that reads a `.cutie` session file and produces a CSV
file of raw probe data with 10-second rolling summary values appended at the appropriate
probe lines — replicating the live chart behavior as closely as possible.

## Script Location & Execution

- **File:** `analyze-cutie.ts` at the repo root
- **Shebang:** `#!/usr/bin/env npx tsx`
- **Install:** `chmod +x analyze-cutie.ts` + symlink to `~/bin/analyze-cutie`
- **Invocation:** `analyze-cutie Cutie_Results-2026-03-10_20-39-01.cutie`

## Input

- Gzip-compressed `.cutie` file only (no plain-text fallback)
- Format: `#` header lines, then `seq,sentAt,receivedAt` CSV rows

## Output

- Same directory as input, `.csv` extension replacing `.cutie`
- All `#` header lines passed through unchanged
- All raw probe lines passed through unchanged
- The **last probe line with `sentAt < t_tick`** for each tick gets 5 summary fields appended
- Prints `Written to <path>.csv` on success

### CSV column header line

```
seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms
```

### Example output

```
# cutie v0.2.25
# session-start: 2026-03-10 20:39:01
...
seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms
100,1741650000000,1741650000012
101,1741650000100,1741650000113
...
199,1741650009900,1741650009912,20:39:11,4.40,0.00,12.34,1.23
200,1741650010000,1741650010011
...
299,1741650019900,,,20:39:21,3.95,2.00,13.01,1.45
```

## Algorithm

Mirrors the live chart behavior in `mosStore.ts`:

1. `origin = probes[0].sentAt`
2. Ticks fire at `t_tick = origin + k × 10_000` for k = 1, 2, 3, …
3. Each tick's rolling window: probes with `sentAt ∈ [t_tick − 10_000, t_tick)`
4. From window probes compute:
   - `packetLossPercent = lost / total × 100` (null if no probes)
   - `avgLatencyMs = mean(receivedAt − sentAt)` over received probes (null if none)
   - `avgJitterMs = mean(|lat_i − lat_{i−1}|)` over consecutive received probes (null if < 2)
   - `mos` via `calculateMosScore(avgLatencyMs, avgJitterMs, packetLossPercent)`
5. Find the last probe with `sentAt < t_tick` — append the 5 summary fields to that line
6. If the window has no probes, skip the tick (no summary appended)
7. `time` = wall-clock time at `t_tick`: `new Date(t_tick)` formatted as `HH:MM:SS`

## MOS

Imports `calculateMosScore` directly from `src/lib/stores/mosStore.ts` — no reimplementation.
