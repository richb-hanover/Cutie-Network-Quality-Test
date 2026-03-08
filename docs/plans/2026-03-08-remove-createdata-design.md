# Remove `?createData=1` Feature

**Date:** 2026-03-08
**Status:** Approved

## Overview

Remove the never-debugged `?createData=1` test-data recording feature and all related code. The feature was incomplete, causing the one failing test in the suite, and leaving dead code across five files.

## Scope

Full removal (Option A). No stubs or feature flags — the implementation can be recovered from git history if needed.

## Files Changed

| File                                            | Change                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/inject-latency-info.test.ts`             | Delete entirely                                                                         |
| `src/lib/latency-probe.ts`                      | Remove `LatencyProbePlaybackRecord`, `injectLatencyInfo`, `collectSamples`, `onSamples` |
| `src/lib/webrtc.ts`                             | Remove `setCreateDataMode`, `downloadLatencyProbeCsv`, CSV types/state/constants        |
| `src/lib/components/LatencyMonitorPanel.svelte` | Remove `getLatencyMonitorStats` export only                                             |
| `src/routes/+page.svelte`                       | Remove `isCreateDataMode`, reactive assignments, `setCreateDataMode` import/call        |
| `CLAUDE.md`                                     | Remove `?createData=1` from Debugging section                                           |

## Detail

### `latency-probe.ts`

- Remove `LatencyProbePlaybackRecord` type
- Remove `injectLatencyInfo` from return type and implementation
- Remove `collectSamples` and `onSamples` from `InitializeLatencyMonitorOptions`
- The `appendHistory` call that was gated on `collectSamples` becomes unconditional (history is still needed for the latency monitor display)

### `webrtc.ts`

- Remove `setCreateDataMode()` and all internals
- Remove `downloadLatencyProbeCsv()` and related: `LatencyProbeCsvRow`, `LATENCY_CSV_HEADER`, `savedCsv`, `recordedProbes` state
- Simplify `initializeLatencyMonitor` call (remove `collectSamples`/`onSamples` args)

### `LatencyMonitorPanel.svelte`

- Remove `getLatencyMonitorStats` export
- All other component functionality stays unchanged

### `+page.svelte`

- Remove `isCreateDataMode` variable (line 44)
- Remove reactive `$:` assignments for `isCreateDataMode` and `setCreateDataMode`
- Remove `setCreateDataMode` from imports

### `CLAUDE.md`

- Remove `?createData=1` bullet from Debugging section

## Success Criteria

- `npm test` passes with zero failures
- `npm run lint` passes
- No references to `createData`, `injectLatencyInfo`, `getLatencyMonitorStats`, `setCreateDataMode`, `collectSamples`, `onSamples`, `LatencyProbePlaybackRecord`, `downloadLatencyProbeCsv` remain in the codebase
