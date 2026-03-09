# Cutie Save / Reload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Save (Cmd/Ctrl-S or button) and Reload (button or drag-and-drop) so users can capture a session to a `.cutie` file and reconstitute the window from it later.

**Architecture:** Pure Approach A — save raw probe timestamps (`sentAt`, `receivedAt`) plus pre-computed panel snapshots; on reload set panel values directly and recompute charts from raw probes. `sentAt`/`receivedAt` are stored as Unix ms using an epoch offset captured at session start. The file content is gzip-compressed using the browser's native `CompressionStream`/`DecompressionStream` API (no library needed), reducing typical file size from ~2.5 MB to ~400–600 KB. A new `session-file.ts` holds all format/parse/compress logic; `webrtc.ts` holds `saveSession()` and `loadSession()`; `+page.svelte` owns the UI wiring.

**Tech Stack:** TypeScript, Svelte 4, Vitest, SvelteKit

**Design doc:** `docs/plans/2026-03-09-cutie-save-reload-design.md`

---

### Task 1: Add `sentAt` to `LatencySample` and populate it

**Files:**
- Modify: `src/lib/latency-probe.ts`

The `LatencySample` type needs a `sentAt` field so the raw probe accumulator (Task 2) can capture the exact send timestamp for every probe — including lost ones.

**Step 1: Add `sentAt: number` to the `LatencySample` type**

In `src/lib/latency-probe.ts`, change:

```typescript
export type LatencySample = {
	seq: number;
	status: 'received' | 'lost';
	latencyMs: number | null;
	jitterMs: number | null;
	at: string;
	timestampMs: number;
};
```

to:

```typescript
export type LatencySample = {
	seq: number;
	sentAt: number;
	status: 'received' | 'lost';
	latencyMs: number | null;
	jitterMs: number | null;
	at: string;
	timestampMs: number;
};
```

**Step 2: Populate `sentAt` in `receiveProbe()`**

Find the `sample` construction in `receiveProbe()` (around line 352). Change:

```typescript
const sample: LatencySample = {
	seq,
	status: 'received',
	latencyMs,
	jitterMs,
	at: formatTimestamp(),
	timestampMs: receivedAt
};
```

to:

```typescript
const sample: LatencySample = {
	seq,
	sentAt: startedAt,
	status: 'received',
	latencyMs,
	jitterMs,
	at: formatTimestamp(),
	timestampMs: receivedAt
};
```

**Step 3: Populate `sentAt` in `recordLostProbes()`**

The current code deletes from `pendingProbes` before building `lostSamples`. Fix the ordering so we capture `sentAt` first. Find the lost-probe block (around line 202) and change:

```typescript
// delete the lost probes from pendingProbes Map
for (const seq of lost) {
	pendingProbes.delete(seq);
}

// lostSamples array contains info about those lost samples
const lostSamples: LatencySample[] = lost.map((seq) => ({
	seq,
	status: 'lost',
	latencyMs: null,
	jitterMs: null,
	at: formatTimestamp(),
	timestampMs: currentTime
}));
```

to:

```typescript
// Capture sentAt before deleting from pendingProbes
const lostWithSentAt = lost.map((seq) => ({ seq, sentAt: pendingProbes.get(seq)! }));

for (const seq of lost) {
	pendingProbes.delete(seq);
}

const lostSamples: LatencySample[] = lostWithSentAt.map(({ seq, sentAt }) => ({
	seq,
	sentAt,
	status: 'lost',
	latencyMs: null,
	jitterMs: null,
	at: formatTimestamp(),
	timestampMs: currentTime
}));
```

**Step 4: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all 7 tests pass, 0 lint errors.

**Step 5: Commit**

```bash
git add src/lib/latency-probe.ts
git commit -m "feat: add sentAt field to LatencySample"
```

---

### Task 2: Add raw probe accumulator and epoch offset to `webrtc.ts`

**Files:**
- Modify: `src/lib/webrtc.ts`

During a live session, accumulate every probe's raw `{seq, sentAt, receivedAt}` in Unix ms. This is what gets written to the `.cutie` file. Also record the epoch offset so performance.now() values can be converted to Unix timestamps.

**Step 1: Add module-level state**

After the existing `let messageId = 0;` line, add:

```typescript
let rawProbes: Array<{ seq: number; sentAt: number; receivedAt: number | null }> = [];
let epochOffsetMs = 0; // Date.now() - performance.now() at session start
```

**Step 2: Record epoch offset at session start**

In `beginCollectionSession()`, add the first line:

```typescript
function beginCollectionSession(dataChannel: RTCDataChannel): void {
	epochOffsetMs = Date.now() - performance.now();
	const startAt = Date.now();
	// ... rest unchanged ...
```

**Step 3: Clear rawProbes when a new session starts**

In `connectToServer()`, after the existing `clearCollectionAutoStopTimer()` call, add:

```typescript
rawProbes = [];
epochOffsetMs = 0;
```

**Step 4: Accumulate probes in the `onSamples` callback**

In the `initializeLatencyMonitor` call, extend the `onSamples` callback:

```typescript
onSamples: (samples) => {
	ingestLatencySamples(samples);
	for (const s of samples) {
		rawProbes.push({
			seq: s.seq,
			sentAt: Math.round(s.sentAt + epochOffsetMs),
			receivedAt: s.latencyMs !== null ? Math.round(s.sentAt + s.latencyMs + epochOffsetMs) : null
		});
	}
},
```

**Step 5: Export an accessor for the accumulator**

At the bottom of the file, add:

```typescript
export function getRawProbes(): Array<{ seq: number; sentAt: number; receivedAt: number | null }> {
	return rawProbes;
}

export function getEpochOffsetMs(): number {
	return epochOffsetMs;
}
```

**Step 6: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all 7 tests pass, 0 lint errors.

**Step 7: Commit**

```bash
git add src/lib/webrtc.ts
git commit -m "feat: accumulate raw probes and epoch offset in webrtc"
```

---

### Task 3: Create `src/lib/session-file.ts` with format and parse logic

**Files:**
- Create: `src/lib/session-file.ts`
- Create: `tests/session-file.test.ts`

All file I/O logic lives here as pure functions. No browser APIs except in `downloadCutieFile` (which is not unit-tested).

**Step 1: Write the failing tests first**

Create `tests/session-file.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatCutieFile, parseCutieFile, type SessionFileData } from '../src/lib/session-file';
import type { LatencyStats } from '../src/lib/latency-probe';

const makeSampleData = (): SessionFileData => ({
	version: '0.2.21',
	sessionStartMs: 1741234500000,
	connectionId: 'test-conn-123',
	durationMs: 300000,
	latencyStats: {
		lastLatencyMs: 28.3,
		averageLatencyMs: 31.2,
		jitterMs: 2.1,
		totalSent: 3000,
		totalReceived: 2995,
		totalLost: 5,
		history: []
	} satisfies LatencyStats,
	bounds: {
		latencyMs: { min: 18.0, max: 210.0 },
		jitterMs: { min: 0.4, max: 18.7 },
		packetLossPercent: { min: 0.0, max: 2.3 },
		mos: { min: 3.8, max: 4.4 }
	},
	tenSecondAverages: {
		averageLatencyMs: 31.2,
		averageJitterMs: 2.1,
		packetLossPercent: 0.07
	},
	tenSecondMos: 4.1,
	bytesSent: 1048576,
	probes: [
		{ seq: 0, sentAt: 1741234500100, receivedAt: 1741234500142 },
		{ seq: 1, sentAt: 1741234500200, receivedAt: 1741234500243 },
		{ seq: 2, sentAt: 1741234500300, receivedAt: null }
	]
});

describe('session-file', () => {
	it('round-trips through format and parse', () => {
		const original = makeSampleData();
		const content = formatCutieFile(original);
		const parsed = parseCutieFile(content);

		expect(parsed.version).toBe(original.version);
		expect(parsed.sessionStartMs).toBe(original.sessionStartMs);
		expect(parsed.connectionId).toBe(original.connectionId);
		expect(parsed.durationMs).toBe(original.durationMs);
		expect(parsed.latencyStats.lastLatencyMs).toBeCloseTo(original.latencyStats.lastLatencyMs!, 2);
		expect(parsed.latencyStats.totalSent).toBe(original.latencyStats.totalSent);
		expect(parsed.latencyStats.totalLost).toBe(original.latencyStats.totalLost);
		expect(parsed.bounds.latencyMs.min).toBeCloseTo(original.bounds.latencyMs.min!, 2);
		expect(parsed.bounds.mos.max).toBeCloseTo(original.bounds.mos.max!, 2);
		expect(parsed.bytesSent).toBe(original.bytesSent);
		expect(parsed.probes).toHaveLength(3);
		expect(parsed.probes[0]).toEqual({ seq: 0, sentAt: 1741234500100, receivedAt: 1741234500142 });
		expect(parsed.probes[2]).toEqual({ seq: 2, sentAt: 1741234500300, receivedAt: null });
	});

	it('generates correct filename from sessionStartMs', () => {
		const content = formatCutieFile(makeSampleData());
		expect(content).toContain('# cutie v0.2.21');
		expect(content).toContain('seq,sentAt,receivedAt');
	});

	it('parseCutieFile throws on invalid content', () => {
		expect(() => parseCutieFile('not a cutie file')).toThrow();
	});
});
```

**Step 2: Run to confirm tests fail**

```bash
npm test -- tests/session-file.test.ts
```

Expected: FAIL — `session-file` module not found.

**Step 3: Create `src/lib/session-file.ts`**

```typescript
import type { LatencyStats } from '$lib/latency-probe';
import type { RecentAverages } from '$lib/stores/mosStore';

export type RawProbe = {
	seq: number;
	sentAt: number;   // Unix ms
	receivedAt: number | null; // Unix ms, null = lost
};

export type SessionBounds = {
	latencyMs: { min: number | null; max: number | null };
	jitterMs: { min: number | null; max: number | null };
	packetLossPercent: { min: number | null; max: number | null };
	mos: { min: number | null; max: number | null };
};

export type SessionFileData = {
	version: string;
	sessionStartMs: number;    // Unix ms
	connectionId: string | null;
	durationMs: number;
	latencyStats: LatencyStats;
	bounds: SessionBounds;
	tenSecondAverages: RecentAverages;
	tenSecondMos: number | null;
	bytesSent: number;
	probes: RawProbe[];
};

const n = (v: number | null): string => (v === null ? '' : String(v));
const parseN = (s: string): number | null => (s === '' || s === 'null' ? null : Number(s));

export function formatCutieFile(data: SessionFileData): string {
	const lines: string[] = [
		`# cutie v${data.version}`,
		`# session-start-ms=${data.sessionStartMs}`,
		`# connection-id=${data.connectionId ?? ''}`,
		`# duration-ms=${data.durationMs}`,
		`# last-latency-ms=${n(data.latencyStats.lastLatencyMs)}`,
		`# average-latency-ms=${n(data.latencyStats.averageLatencyMs)}`,
		`# jitter-ms=${n(data.latencyStats.jitterMs)}`,
		`# total-sent=${data.latencyStats.totalSent}`,
		`# total-received=${data.latencyStats.totalReceived}`,
		`# total-lost=${data.latencyStats.totalLost}`,
		`# bounds-latency-min=${n(data.bounds.latencyMs.min)}`,
		`# bounds-latency-max=${n(data.bounds.latencyMs.max)}`,
		`# bounds-jitter-min=${n(data.bounds.jitterMs.min)}`,
		`# bounds-jitter-max=${n(data.bounds.jitterMs.max)}`,
		`# bounds-loss-min=${n(data.bounds.packetLossPercent.min)}`,
		`# bounds-loss-max=${n(data.bounds.packetLossPercent.max)}`,
		`# bounds-mos-min=${n(data.bounds.mos.min)}`,
		`# bounds-mos-max=${n(data.bounds.mos.max)}`,
		`# ten-second-latency-ms=${n(data.tenSecondAverages.averageLatencyMs)}`,
		`# ten-second-jitter-ms=${n(data.tenSecondAverages.averageJitterMs)}`,
		`# ten-second-loss=${n(data.tenSecondAverages.packetLossPercent)}`,
		`# ten-second-mos=${n(data.tenSecondMos)}`,
		`# bytes-sent=${data.bytesSent}`,
		`seq,sentAt,receivedAt`
	];

	for (const p of data.probes) {
		lines.push(`${p.seq},${p.sentAt},${p.receivedAt ?? ''}`);
	}

	return lines.join('\n') + '\n';
}

export function parseCutieFile(content: string): SessionFileData {
	const lines = content.split('\n');
	const headers: Record<string, string> = {};
	const probes: RawProbe[] = [];
	let inData = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith('seq,sentAt,receivedAt')) {
			inData = true;
			continue;
		}

		if (trimmed.startsWith('#')) {
			const body = trimmed.slice(1).trim();
			const eq = body.indexOf('=');
			if (eq !== -1) {
				headers[body.slice(0, eq).trim()] = body.slice(eq + 1).trim();
			}
			continue;
		}

		if (inData) {
			const parts = trimmed.split(',');
			if (parts.length < 2) continue;
			probes.push({
				seq: Number(parts[0]),
				sentAt: Number(parts[1]),
				receivedAt: parts[2] ? Number(parts[2]) : null
			});
		}
	}

	const version = headers['cutie v'] ?? headers['version'] ?? '';
	// Extract version from "# cutie v0.2.21" — stored in key "cutie v0.2.21" with no =
	// Re-parse: look for "cutie v" prefix in original lines
	const versionLine = lines.find((l) => /^# cutie v/.test(l.trim()));
	const parsedVersion = versionLine ? versionLine.replace(/^#\s*cutie v/, '').trim() : version;

	if (!headers['session-start-ms']) {
		throw new Error('Invalid .cutie file: missing session-start-ms');
	}

	return {
		version: parsedVersion,
		sessionStartMs: Number(headers['session-start-ms']),
		connectionId: headers['connection-id'] || null,
		durationMs: Number(headers['duration-ms'] ?? 0),
		latencyStats: {
			lastLatencyMs: parseN(headers['last-latency-ms'] ?? ''),
			averageLatencyMs: parseN(headers['average-latency-ms'] ?? ''),
			jitterMs: parseN(headers['jitter-ms'] ?? ''),
			totalSent: Number(headers['total-sent'] ?? 0),
			totalReceived: Number(headers['total-received'] ?? 0),
			totalLost: Number(headers['total-lost'] ?? 0),
			history: []
		},
		bounds: {
			latencyMs: { min: parseN(headers['bounds-latency-min'] ?? ''), max: parseN(headers['bounds-latency-max'] ?? '') },
			jitterMs: { min: parseN(headers['bounds-jitter-min'] ?? ''), max: parseN(headers['bounds-jitter-max'] ?? '') },
			packetLossPercent: { min: parseN(headers['bounds-loss-min'] ?? ''), max: parseN(headers['bounds-loss-max'] ?? '') },
			mos: { min: parseN(headers['bounds-mos-min'] ?? ''), max: parseN(headers['bounds-mos-max'] ?? '') }
		},
		tenSecondAverages: {
			averageLatencyMs: parseN(headers['ten-second-latency-ms'] ?? ''),
			averageJitterMs: parseN(headers['ten-second-jitter-ms'] ?? ''),
			packetLossPercent: parseN(headers['ten-second-loss'] ?? '')
		},
		tenSecondMos: parseN(headers['ten-second-mos'] ?? ''),
		bytesSent: Number(headers['bytes-sent'] ?? 0),
		probes
	};
}

export function cutieFilename(sessionStartMs: number): string {
	const d = new Date(sessionStartMs);
	const pad = (n: number) => String(n).padStart(2, '0');
	const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
	return `Cutie_Results-${ts}.cutie`;
}

export async function downloadCutieFile(content: string, sessionStartMs: number): Promise<void> {
	const compressed = await new Response(
		new Blob([content]).stream().pipeThrough(new CompressionStream('gzip'))
	).blob();
	const url = URL.createObjectURL(compressed);
	const a = document.createElement('a');
	a.href = url;
	a.download = cutieFilename(sessionStartMs);
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export async function decompressCutieFile(file: File): Promise<string> {
	return new Response(
		file.stream().pipeThrough(new DecompressionStream('gzip'))
	).text();
}
```

**Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/session-file.test.ts
```

Expected: 3 tests pass.

**Step 5: Run full test suite and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, 0 lint errors. If lint reports line-length issues in the long `parseCutieFile` lines, run `npm run format` to auto-fix.

**Step 6: Commit**

```bash
git add src/lib/session-file.ts tests/session-file.test.ts
git commit -m "feat: add session-file format/parse/download functions"
```

---

### Task 4: Add replay functions to `mosStore.ts`

**Files:**
- Modify: `src/lib/stores/mosStore.ts`

On reload, charts need to be populated from raw probe data. `loadSessionSummaries()` converts probes → 10-second buckets → `summaryHistoryStore`. `loadRecentAverages()` sets the 10s-avg display values directly.

**Step 1: Add the two load functions at the bottom of `mosStore.ts`**

Import `RawProbe` at the top:

```typescript
import type { RawProbe } from '$lib/session-file';
```

Then add before the final export:

```typescript
export const loadRecentAverages = (averages: RecentAverages, mos: number | null): void => {
	recentAveragesStore.set(averages);
	mosAverageStore.set(mos);
};

export const loadSessionSummaries = (probes: RawProbe[]): void => {
	if (probes.length === 0) return;

	const TEN_S = 10_000;
	const origin = probes[0].sentAt;
	const buckets = new Map<number, RawProbe[]>();

	for (const p of probes) {
		const bucket = Math.floor((p.sentAt - origin) / TEN_S);
		const list = buckets.get(bucket) ?? [];
		list.push(p);
		buckets.set(bucket, list);
	}

	const summaries: TenSecondSummary[] = [];

	for (const [bucket, ps] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
		const received = ps.filter((p) => p.receivedAt !== null);
		const lost = ps.filter((p) => p.receivedAt === null).length;
		const total = ps.length;

		const packetLossPercent = total > 0 ? (lost / total) * 100 : null;

		let latencySum = 0;
		let jitterSum = 0;
		let prevLatency: number | null = null;

		for (const p of received) {
			const latency = p.receivedAt! - p.sentAt;
			latencySum += latency;
			if (prevLatency !== null) {
				jitterSum += Math.abs(latency - prevLatency);
			}
			prevLatency = latency;
		}

		const avgLatency = received.length > 0 ? latencySum / received.length : null;
		const avgJitter = received.length > 1 ? jitterSum / (received.length - 1) : null;
		const mos = calculateMosScore(avgLatency, avgJitter, packetLossPercent);

		summaries.push({
			at: origin + bucket * TEN_S,
			mos,
			packetLossPercent,
			averageLatencyMs: avgLatency,
			averageJitterMs: avgJitter
		});
	}

	summaryHistoryStore.set(summaries.slice(-MAX_HISTORY_SAMPLES));
};
```

**Step 2: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, 0 lint errors.

**Step 3: Commit**

```bash
git add src/lib/stores/mosStore.ts
git commit -m "feat: add loadRecentAverages and loadSessionSummaries to mosStore"
```

---

### Task 5: Export `bounds` from `LatencyMonitorPanel.svelte`

**Files:**
- Modify: `src/lib/components/LatencyMonitorPanel.svelte`

`+page.svelte` needs to read the current `bounds` (for saving) and write initial bounds (for reloading). Making `bounds` an exported `let` enables two-way binding via `bind:bounds`.

**Step 1: Change `let bounds` to `export let bounds`**

In the `<script>` section, change:

```typescript
let bounds = createMetricBounds();
```

to:

```typescript
export let bounds = createMetricBounds();
```

**Step 2: Run lint**

```bash
npm run lint
```

Expected: 0 errors. (Tests don't cover the Svelte component directly.)

**Step 3: Commit**

```bash
git add src/lib/components/LatencyMonitorPanel.svelte
git commit -m "feat: export bounds from LatencyMonitorPanel for save/load"
```

---

### Task 6: Implement `saveSession()` in `webrtc.ts`

**Files:**
- Modify: `src/lib/webrtc.ts`

**Step 1: Add imports at the top of `webrtc.ts`**

```typescript
import {
	formatCutieFile,
	downloadCutieFile,
	type SessionBounds,
	type SessionFileData
} from '$lib/session-file';
// Note: downloadCutieFile is async; saveSession must be async too.
import { tenSecondAverages, tenSecondMos } from '$lib/stores/mosStore';
import { get as getStore } from 'svelte/store';
```

(`get` is already imported as `get` from `svelte/store` — rename the new one or reuse the existing import. The file already imports `get` so just add the other imports.)

**Step 2: Add `saveSession()` export at the bottom**

```typescript
export async function saveSession(bounds: SessionBounds, version: string): Promise<void> {
	const state = get(webrtcState);
	if (!state.collectionStartAt) return;

	const durationMs = (state.collectionEndAt ?? Date.now()) - state.collectionStartAt;
	const averages = getStore(tenSecondAverages);
	const mos = getStore(tenSecondMos);

	const data: SessionFileData = {
		version: '', // filled by +page.svelte which has access to buildVersion
		sessionStartMs: state.collectionStartAt,
		connectionId: state.connectionId,
		durationMs,
		latencyStats: state.latencyStats,
		bounds,
		tenSecondAverages: averages,
		tenSecondMos: mos,
		bytesSent: state.statsSummary?.bytesSent ?? 0,
		probes: rawProbes
	};

	const content = formatCutieFile(data);
	downloadCutieFile(content, state.collectionStartAt);
}
```

Note: `version` will be patched by the caller in `+page.svelte` (which has `buildVersion`). Alternatively, pass version as a parameter:

```typescript
export function saveSession(bounds: SessionBounds, version: string): void {
	// ... same as above but use the version parameter
	const data: SessionFileData = {
		version,
		// ...
	};
```

Use the parameter version — it's cleaner than an empty string.

**Step 3: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, 0 lint errors.

**Step 4: Commit**

```bash
git add src/lib/webrtc.ts
git commit -m "feat: add saveSession() to webrtc"
```

---

### Task 7: Implement `loadSession()` in `webrtc.ts`

**Files:**
- Modify: `src/lib/webrtc.ts`

**Step 1: Add additional imports**

```typescript
import { parseCutieFile, type SessionFileData } from '$lib/session-file';
import { loadRecentAverages, loadSessionSummaries } from '$lib/stores/mosStore';
```

**Step 2: Add `loadSession()` export at the bottom**

```typescript
export async function loadSession(content: string): Promise<SessionFileData | null> {
	let data: SessionFileData;
	try {
		data = parseCutieFile(content);
	} catch {
		return null;
	}

	// Stop any live session first
	const state = get(webrtcState);
	if (state.connection || state.isConnecting) {
		await disconnect('manual', { suppressMessage: true });
	}

	// Clear accumulated probes
	rawProbes = [];
	epochOffsetMs = 0;
	resetMosData();

	// Synthetic "Reloaded" message
	const reloadedMessage = JSON.stringify({
		type: 'Reloaded',
		sessionStart: new Date(data.sessionStartMs).toISOString(),
		connectionId: data.connectionId,
		durationMs: data.durationMs
	});

	// Synthetic statsSummary for Long-term Statistics panel
	const syntheticStats = {
		timestamp: data.sessionStartMs + data.durationMs,
		bytesSent: data.bytesSent,
		bytesReceived: 0,
		packetsSent: 0,
		packetsReceived: 0,
		messagesSent: 0,
		messagesReceived: 0,
		currentRoundTripTime: null
	};

	webrtcState.update(() => ({
		...initialState,
		latencyStats: data.latencyStats,
		collectionStartAt: data.sessionStartMs,
		collectionEndAt: data.sessionStartMs + data.durationMs,
		connectionId: data.connectionId,
		statsSummary: syntheticStats,
		messages: [
			{
				id: ++messageId,
				direction: 'in',
				payload: reloadedMessage,
				at: new Date(data.sessionStartMs).toLocaleTimeString()
			}
		]
	}));

	// Populate charts from raw probe data
	loadSessionSummaries(data.probes);
	loadRecentAverages(data.tenSecondAverages, data.tenSecondMos);

	return data; // caller uses data.bounds to update LatencyMonitorPanel
}
```

**Step 3: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, 0 lint errors.

**Step 4: Commit**

```bash
git add src/lib/webrtc.ts
git commit -m "feat: add loadSession() to webrtc"
```

---

### Task 8: Wire up Save/Reload UI in `+page.svelte`

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add imports**

In the existing import block, add:

```typescript
import { saveSession, loadSession, getRawProbes } from '$lib/webrtc';
import { decompressCutieFile, type SessionBounds } from '$lib/session-file';
```

**Step 2: Add `panelBounds` variable and bind to `LatencyMonitorPanel`**

Add after the existing `let` declarations (around line 44):

```typescript
let panelBounds: SessionBounds | undefined;
```

Find the `<LatencyMonitorPanel>` usage in the template and add `bind:bounds`:

```svelte
<LatencyMonitorPanel
	{latencyStats}
	showHistory={SHOW_RECENT_PROBES_HISTORY}
	bind:bounds={panelBounds}
/>
```

**Step 3: Add save and load handler functions**

Add these functions in the `<script>` section:

```typescript
async function handleSave() {
	if (!panelBounds) return;
	await saveSession(panelBounds, buildVersion);
}

async function handleLoad(file: File) {
	const content = await decompressCutieFile(file);
	const data = await loadSession(content);
	if (data) {
		panelBounds = data.bounds;
	}
}

function handleFileInput(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) void handleLoad(file);
	input.value = ''; // reset so same file can be reloaded
}
```

**Step 4: Add Cmd/Ctrl-S keyboard handler**

Find the existing `onMount` (or add one if absent). Inside it:

```typescript
onMount(() => {
	const handleKeydown = (e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement)?.tagName;
		if (textInputTags.has(tag)) return; // don't intercept typing in inputs
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (getRawProbes().length > 0) handleSave();
		}
	};
	window.addEventListener('keydown', handleKeydown);
	return () => window.removeEventListener('keydown', handleKeydown);
});
```

**Step 5: Add drag-and-drop handler to the main container**

Find the `<main>` or outer container element and add:

```svelte
<main
	class="container"
	on:dragover|preventDefault={(e) => { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
	on:drop|preventDefault={(e) => {
		const file = e.dataTransfer?.files?.[0];
		if (file?.name.endsWith('.cutie')) void handleLoad(file);
	}}
>
```

**Step 6: Add Save/Reload buttons below the Message Log section**

After the closing `</section>` of the Message Log (around line 318), add:

```svelte
<section class="panel save-reload">
	<div class="save-reload-buttons">
		<button on:click={handleSave} disabled={getRawProbes().length === 0}>
			Save Session
		</button>
		<label class="reload-button">
			Reload Session
			<input
				type="file"
				accept=".cutie"
				style="display:none"
				on:change={handleFileInput}
			/>
		</label>
	</div>
</section>
```

Add to `<style>`:

```css
.save-reload-buttons {
	display: flex;
	gap: 0.75rem;
}

.reload-button {
	display: inline-block;
	padding: 0.4rem 0.9rem;
	background: #fff;
	border: 1px solid #d1d5db;
	border-radius: 0.375rem;
	cursor: pointer;
	font-size: inherit;
}
```

**Step 7: Run tests and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass, 0 lint errors. If lint warns about `$lib/session-file` imports, check that the path is correct.

**Step 8: Manual smoke test**

```bash
npm run dev
```

- Start a collection, let it run for 30 seconds, click Save — verify a `.cutie` file downloads
- Open the file in a hex editor or `file` command — verify it is gzip-compressed (`1f 8b` magic bytes)
- To inspect the text content: `gunzip -c Cutie_Results-*.cutie | head -30`
- Drag the `.cutie` file onto the window — verify the panels repopulate and the Message Log shows a `Reloaded` message
- Click Reload — verify the file picker opens and a `.cutie` file can be selected

**Step 9: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: add Save/Reload buttons, Cmd-S shortcut, and drag-and-drop to page"
```

---

### Task 9: Final verification

**Step 1: Confirm no stray references**

```bash
grep -r "panelBounds\|SessionBounds\|RawProbe\|session-file\|saveSession\|loadSession" src tests
```

Expected: only intended usages in the files added/modified above.

**Step 2: Run full test suite and lint**

```bash
npm test && npm run lint
```

Expected: all tests pass (including the new `session-file` tests), 0 lint errors.

**Step 3: Verify file size**

Write a small Node script or use the browser console to confirm that a 2-hour session produces a `.cutie` file ≤ 3 MB.
