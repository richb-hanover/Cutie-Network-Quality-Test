# Remove `?createData=1` Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the never-debugged `?createData=1` test-data recording feature and all dead code it introduced across six files.

**Architecture:** Pure deletion — no new code. Remove symbols in dependency order: test → latency-probe → webrtc → LatencyMonitorPanel → page.svelte → CLAUDE.md. Verify after each task.

**Tech Stack:** TypeScript, Svelte, Vitest

---

### Task 1: Delete the test file

**Files:**

- Delete: `tests/inject-latency-info.test.ts`

**Step 1: Delete the file**

```bash
rm tests/inject-latency-info.test.ts
```

**Step 2: Run tests — confirm the failure is gone**

```bash
npm test
```

Expected: all remaining tests pass (was 1 failed | 7 passed — now 0 failed | 7 passed)

**Step 3: Commit**

```bash
git add tests/inject-latency-info.test.ts
git commit -m "test: remove broken inject-latency-info test"
```

---

### Task 2: Clean up `latency-probe.ts`

**Files:**

- Modify: `src/lib/latency-probe.ts`

Remove the following (in order, top to bottom):

**Step 1: Remove `LatencyProbePlaybackRecord` type**

Delete lines 34–38:

```typescript
export type LatencyProbePlaybackRecord = {
	seq: number;
	sentAt: number;
	receivedAt: number;
};
```

**Step 2: Remove `injectLatencyInfo` from `LatencyMonitor` type**

Delete line 49:

```typescript
	injectLatencyInfo: (records: LatencyProbePlaybackRecord[]) => void;
```

**Step 3: Remove `onSamples` and `collectSamples` from `LatencyMonitorOptions`**

Delete lines 58–59:

```typescript
	onSamples?: (samples: LatencySample[]) => void;
	collectSamples?: boolean;
```

**Step 4: Remove `onSamples` and `collectSamples` from destructuring in `initializeLatencyMonitor`**

Delete lines 94–95:

```typescript
		onSamples,
		collectSamples = true,
```

**Step 5: Make `appendHistory` unconditional in `integrateSamples`**

Change line 138 from:

```typescript
const history = collectSamples ? appendHistory(samples) : previous.history;
```

to:

```typescript
const history = appendHistory(samples);
```

**Step 6: Remove the `onSamples` call in `integrateSamples`**

Delete line 140:

```typescript
onSamples?.(samples);
```

**Step 7: Remove `injectLatencyInfo` from the return object**

Delete lines 391–452 (the entire `injectLatencyInfo` property):

```typescript
injectLatencyInfo: (records: LatencyProbePlaybackRecord[]) => {
	// ... entire implementation ...
};
```

Also remove the trailing comma from `getStats: () => latencyStats,` if needed to keep valid JS.

**Step 8: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

**Step 9: Commit**

```bash
git add src/lib/latency-probe.ts
git commit -m "refactor: remove injectLatencyInfo and collectSamples from latency-probe"
```

---

### Task 3: Clean up `webrtc.ts`

**Files:**

- Modify: `src/lib/webrtc.ts`

**Step 1: Remove `LatencyProbeCsvRow` type**

Delete lines 16–20:

```typescript
export type LatencyProbeCsvRow = {
	seq: number;
	sentAt: number;
	receivedAt: number;
};
```

**Step 2: Remove `recordedProbes` and `isCreateDataMode` from `WebRtcState` type**

Delete lines 45–46:

```typescript
	recordedProbes: LatencyProbeCsvRow[];
	isCreateDataMode: boolean;
```

**Step 3: Remove from `initialState`**

Delete lines 65–66:

```typescript
	recordedProbes: [],
	isCreateDataMode: false
```

**Step 4: Remove `LATENCY_CSV_HEADER` constant**

Delete line 70:

```typescript
const LATENCY_CSV_HEADER = '# sequence,sentAt,receivedAt';
```

**Step 5: Remove `collectSamples` and `onProbeReceived` from `initializeLatencyMonitor` call**

Change lines 81–101 from:

```typescript
const latencyProbe = initializeLatencyMonitor({
	collectSamples: false,
	onStats: (stats) => {
		const snapshot = { ...stats, history: [] };
		webrtcState.update((state) => ({ ...state, latencyStats: snapshot }));
		updateMosLatencyStats(snapshot);
	},
	onSamples: (samples) => {
		ingestLatencySamples(samples);
	},
	onProbeReceived: ({ seq, sentAt, receivedAt }) => {
		const state = get(webrtcState);
		if (!state.isCreateDataMode) {
			return;
		}
		webrtcState.update((current) => ({
			...current,
			recordedProbes: [...current.recordedProbes, { seq, sentAt, receivedAt }]
		}));
	}
});
```

to:

```typescript
const latencyProbe = initializeLatencyMonitor({
	onStats: (stats) => {
		const snapshot = { ...stats, history: [] };
		webrtcState.update((state) => ({ ...state, latencyStats: snapshot }));
		updateMosLatencyStats(snapshot);
	},
	onSamples: (samples) => {
		ingestLatencySamples(samples);
	}
});
```

**Step 6: Remove `setCreateDataMode` function**

Delete lines 135–146:

```typescript
export function setCreateDataMode(enabled: boolean): void {
	webrtcState.update((state) => {
		if (state.isCreateDataMode === enabled) {
			return state;
		}
		return {
			...state,
			isCreateDataMode: enabled,
			recordedProbes: enabled ? state.recordedProbes : []
		};
	});
}
```

**Step 7: Remove `formatProbeNumber`, `formatFileTimestamp`, and `downloadLatencyProbeCsv` functions**

Delete lines 148–182 (all three functions).

**Step 8: Fix `beginCollectionSession` — remove `recordedProbes` line**

In `beginCollectionSession`, change:

```typescript
webrtcState.update((state) => ({
	...state,
	collectionStartAt: startAt,
	collectionEndAt: null,
	activeDisconnectReason: null,
	collectionStatusMessage: null,
	recordedProbes: state.isCreateDataMode ? [] : state.recordedProbes
}));
```

to:

```typescript
webrtcState.update((state) => ({
	...state,
	collectionStartAt: startAt,
	collectionEndAt: null,
	activeDisconnectReason: null,
	collectionStatusMessage: null
}));
```

**Step 9: Fix `disconnect` function**

Remove `let savedCsv: string | null = null;` (line 408).

Remove the CSV download block (lines 447–449):

```typescript
if (state.isCreateDataMode && state.recordedProbes.length > 0) {
	savedCsv = downloadLatencyProbeCsv(state.recordedProbes);
}
```

Remove `recordedProbes` from the state update in `disconnect` (line 463):

```typescript
		recordedProbes: state.isCreateDataMode ? [] : current.recordedProbes,
```

Remove the `savedCsv` message block (lines 467–475):

```typescript
if (savedCsv && !options.suppressMessage) {
	webrtcState.update((current) => {
		const prefix = current.collectionStatusMessage ? `${current.collectionStatusMessage} ` : '';
		return {
			...current,
			collectionStatusMessage: `${prefix}Saved latency probe data to ${savedCsv}`
		};
	});
}
```

**Step 10: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

**Step 11: Commit**

```bash
git add src/lib/webrtc.ts
git commit -m "refactor: remove setCreateDataMode, CSV recording, and createData state from webrtc"
```

---

### Task 4: Remove `getLatencyMonitorStats` from `LatencyMonitorPanel.svelte`

**Files:**

- Modify: `src/lib/components/LatencyMonitorPanel.svelte`

**Step 1: Remove the `getLatencyMonitorStats` export**

Delete the entire exported function starting at line 104:

```typescript
	export const getLatencyMonitorStats = () => ({
		MOSQuality: toNumberArray([mosInstant, bounds.mos.min, bounds.mos.max, mosAverage]),
		PacketLoss: toNumberArray([...]),
		Latency: toNumberArray([...]),
		Jitter: toNumberArray([...])
	});
```

(Exact end line — find the closing `});` that belongs to this function.)

**Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/components/LatencyMonitorPanel.svelte
git commit -m "refactor: remove getLatencyMonitorStats export from LatencyMonitorPanel"
```

---

### Task 5: Clean up `+page.svelte`

**Files:**

- Modify: `src/routes/+page.svelte`

**Step 1: Remove `setCreateDataMode` from the import**

Line 10 — change:

```typescript
	setCreateDataMode,
```

Delete that line from its import block.

**Step 2: Remove `isCreateDataMode` variable**

Delete line 44:

```typescript
let isCreateDataMode = false;
```

**Step 3: Remove the two reactive statements**

Delete lines 151–152:

```typescript
$: isCreateDataMode = page.url.searchParams.get('createData') === '1';
$: setCreateDataMode(isCreateDataMode);
```

**Step 4: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "refactor: remove createData URL param handling from page"
```

---

### Task 6: Update `CLAUDE.md`

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Remove the `?createData=1` line**

In the Debugging section, delete line 46:

```
- `?createData=1` — records probe data and downloads as CSV
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: remove createData from debugging reference"
```

---

### Task 7: Final verification

**Step 1: Confirm no remaining references**

```bash
grep -r "createData\|injectLatencyInfo\|getLatencyMonitorStats\|setCreateDataMode\|LatencyProbePlaybackRecord\|downloadLatencyProbeCsv\|recordedProbes\|isCreateDataMode\|LATENCY_CSV_HEADER\|LatencyProbeCsvRow" src tests CLAUDE.md
```

Expected: no output.

**Step 2: Run full test and lint**

```bash
npm test && npm run lint
```

Expected: 0 failed tests, 0 lint errors.
