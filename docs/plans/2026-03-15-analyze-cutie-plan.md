# analyze-cutie Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `analyze-cutie.ts` — a TypeScript CLI script at the repo root that reads a gzip-compressed `.cutie` session file and writes a CSV with all raw probe lines plus 10-second rolling window summary values appended to the probe line closest to each 10-second chart tick.

**Architecture:** Single `analyze-cutie.ts` at repo root. Decompresses gzip input, parses header and probe lines, fires virtual "ticks" at `origin + k×10s`, computes a rolling 10-second window at each tick (matching live `computeRecentAverages` behavior), and appends 5 summary fields to the last probe line before each tick. Imports `calculateMosScore` directly from `src/lib/stores/mosStore.ts` — no reimplementation.

**Tech Stack:** TypeScript, Node.js built-in `zlib` (gzip), `npx tsx` (shebang runner), Vitest (tests already configured in `vite.config.ts`).

---

## Key Reference Files

- `src/lib/stores/mosStore.ts` — source of `calculateMosScore`; import as `'./src/lib/stores/mosStore'`
- `src/lib/session-file.ts` — source of `RawProbe` type; import as `'./src/lib/session-file'`
- `vite.config.ts` — Vitest config; tests in `tests/**/*.test.ts` run automatically
- `tests/session-file.test.ts` — example of existing test style

## Output Format

```
# cutie v0.2.25
# session-start: 2026-03-10 20:39:01
... (all original # lines) ...
seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms
100,1741650000000,1741650000012
101,1741650000100,1741650000113
...
199,1741650009900,1741650009912,20:39:11,4.40,0.00,12.34,1.23
200,1741650010000,1741650010011
...
299,1741650019900,,,20:39:21,3.95,2.00,13.01,1.45
```

The 5 appended fields are: `time` (wall-clock `HH:MM:SS` at tick), `mos`, `packet_loss_pct`, `avg_latency_ms`, `avg_jitter_ms` — all formatted to 2 decimal places, empty string if null.

---

## Task 1: Test scaffold

**Files:**

- Create: `tests/analyze-cutie.test.ts`

**Step 1: Create minimal test**

```typescript
import { describe, it, expect } from 'vitest';

describe('analyze-cutie', () => {
	it('placeholder', () => {
		expect(true).toBe(true);
	});
});
```

**Step 2: Run to verify Vitest picks it up**

```bash
cd /Users/richb/github/Cutie-Network-Quality-Test
npm test -- tests/analyze-cutie.test.ts
```

Expected: 1 test passes.

**Step 3: Commit**

```bash
git add tests/analyze-cutie.test.ts
git commit -m "test: add analyze-cutie test scaffold"
```

---

## Task 2: `formatTime` — format a Unix ms timestamp as HH:MM:SS

**Files:**

- Create: `analyze-cutie.ts` (skeleton + `formatTime`)
- Modify: `tests/analyze-cutie.test.ts`

**Step 1: Write the failing test**

Replace the placeholder in `tests/analyze-cutie.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatTime } from '../analyze-cutie';

describe('formatTime', () => {
	it('formats a unix ms timestamp as HH:MM:SS', () => {
		const ms = new Date('2026-03-10T20:39:11Z').getTime();
		expect(formatTime(ms)).toBe('20:39:11');
	});

	it('pads single-digit values', () => {
		const ms = new Date('2026-03-10T01:02:03Z').getTime();
		expect(formatTime(ms)).toBe('01:02:03');
	});
});
```

**Step 2: Run to confirm failure**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: FAIL — `formatTime` not exported.

**Step 3: Create `analyze-cutie.ts`**

```typescript
#!/usr/bin/env npx tsx
import { gunzipSync } from 'zlib';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { calculateMosScore } from './src/lib/stores/mosStore';
import type { RawProbe } from './src/lib/session-file';

export function formatTime(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
```

**Step 4: Run tests**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add analyze-cutie.ts tests/analyze-cutie.test.ts
git commit -m "feat: add analyze-cutie skeleton with formatTime"
```

---

## Task 3: `parseCutieLines` — split file into header lines and typed probe records

**Files:**

- Modify: `analyze-cutie.ts`
- Modify: `tests/analyze-cutie.test.ts`

**Step 1: Write the failing test**

Add to `tests/analyze-cutie.test.ts`:

```typescript
import { parseCutieLines, type ProbeLine } from '../analyze-cutie';

describe('parseCutieLines', () => {
	it('splits header lines from probe data', () => {
		const input = [
			'# cutie v0.2.25',
			'# session-start: 2026-03-10 20:39:01',
			'#',
			'seq,sentAt,receivedAt',
			'0,1000,1012',
			'1,1100,1113',
			'2,1200,'
		].join('\n');

		const result = parseCutieLines(input);

		expect(result.headerLines).toEqual([
			'# cutie v0.2.25',
			'# session-start: 2026-03-10 20:39:01',
			'#'
		]);
		expect(result.probeLines).toEqual([
			{ raw: '0,1000,1012', probe: { seq: 0, sentAt: 1000, receivedAt: 1012 } },
			{ raw: '1,1100,1113', probe: { seq: 1, sentAt: 1100, receivedAt: 1113 } },
			{ raw: '2,1200,', probe: { seq: 2, sentAt: 1200, receivedAt: null } }
		]);
	});
});
```

**Step 2: Run to confirm failure**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: FAIL — `parseCutieLines` not exported.

**Step 3: Add to `analyze-cutie.ts`**

```typescript
export type ProbeLine = {
	raw: string;
	probe: RawProbe;
};

export type ParsedCutie = {
	headerLines: string[];
	probeLines: ProbeLine[];
};

export function parseCutieLines(content: string): ParsedCutie {
	const headerLines: string[] = [];
	const probeLines: ProbeLine[] = [];
	let inData = false;

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith('seq,sentAt,receivedAt')) {
			inData = true;
			continue;
		}

		if (trimmed.startsWith('#')) {
			headerLines.push(line);
			continue;
		}

		if (inData) {
			const parts = trimmed.split(',');
			if (parts.length < 2) continue;
			probeLines.push({
				raw: line,
				probe: {
					seq: Number(parts[0]),
					sentAt: Number(parts[1]),
					receivedAt: parts[2] ? Number(parts[2]) : null
				}
			});
		}
	}

	return { headerLines, probeLines };
}
```

**Step 4: Run tests**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: All pass.

**Step 5: Commit**

```bash
git add analyze-cutie.ts tests/analyze-cutie.test.ts
git commit -m "feat: add parseCutieLines"
```

---

## Task 4: `computeSummaries` — rolling 10-second window ticks

For each virtual tick at `origin + k×10000`, compute stats over probes with `sentAt ∈ [tTick−10000, tTick)`. Attach to the last probe with `sentAt < tTick`.

**Files:**

- Modify: `analyze-cutie.ts`
- Modify: `tests/analyze-cutie.test.ts`

**Step 1: Write the failing tests**

Add to `tests/analyze-cutie.test.ts`:

```typescript
import { computeSummaries, type Summary } from '../analyze-cutie';

describe('computeSummaries', () => {
	it('computes one summary for 100 probes spanning 10s', () => {
		// 10 probes/s, all received 10ms after sent
		const probes: RawProbe[] = Array.from({ length: 100 }, (_, i) => ({
			seq: i,
			sentAt: i * 100, // 0ms … 9900ms
			receivedAt: i * 100 + 10
		}));

		const summaries = computeSummaries(probes);

		expect(summaries).toHaveLength(1);
		expect(summaries[0].probeIndex).toBe(99); // last probe before tick at 10000
		expect(summaries[0].mos).not.toBeNull();
		expect(summaries[0].packetLossPercent).toBeCloseTo(0);
		expect(summaries[0].avgLatencyMs).toBeCloseTo(10);
	});

	it('attaches summary to last probe before tick (throttling gap case)', () => {
		// probe at 9s, next at 13s — gap due to browser throttling
		const probes: RawProbe[] = [
			{ seq: 0, sentAt: 0, receivedAt: 10 },
			{ seq: 1, sentAt: 9000, receivedAt: 9010 }, // last before tick at 10000
			{ seq: 2, sentAt: 13000, receivedAt: 13010 }
		];

		const summaries = computeSummaries(probes);

		// Tick 1 at t=10000: window [0,10000) → probes at 0ms and 9000ms → lastIdx=1
		expect(summaries[0].probeIndex).toBe(1);
		// Tick 2 at t=20000: window [10000,20000) → probe at 13000ms → lastIdx=2
		expect(summaries[1].probeIndex).toBe(2);
	});

	it('skips ticks whose window contains no probes', () => {
		// gap from 5s to 25s — tick at 10s has probes, tick at 20s is empty
		const probes: RawProbe[] = [
			{ seq: 0, sentAt: 0, receivedAt: 10 },
			{ seq: 1, sentAt: 5000, receivedAt: 5010 },
			{ seq: 2, sentAt: 25000, receivedAt: 25010 }
		];

		const summaries = computeSummaries(probes);

		expect(summaries).toHaveLength(2);
		expect(summaries[0].tTick).toBe(10000); // origin=0, k=1
		expect(summaries[1].tTick).toBe(30000); // k=3; k=2 window is empty
	});

	it('returns empty array for empty probe list', () => {
		expect(computeSummaries([])).toEqual([]);
	});
});
```

**Step 2: Run to confirm failure**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: FAIL — `computeSummaries` not exported.

**Step 3: Add to `analyze-cutie.ts`**

```typescript
export type Summary = {
	probeIndex: number; // index into probeLines / probes array
	tTick: number; // absolute Unix ms of the tick
	time: string; // HH:MM:SS
	mos: number | null;
	packetLossPercent: number | null;
	avgLatencyMs: number | null;
	avgJitterMs: number | null;
};

export function computeSummaries(probes: RawProbe[]): Summary[] {
	if (probes.length === 0) return [];

	const TEN_S = 10_000;
	const origin = probes[0].sentAt;
	const lastSentAt = probes[probes.length - 1].sentAt;
	const totalTicks = Math.ceil((lastSentAt - origin) / TEN_S) + 1;

	const summaries: Summary[] = [];

	for (let k = 1; k <= totalTicks; k++) {
		const tTick = origin + k * TEN_S;

		// Rolling window: probes sent within the previous 10 seconds
		const window = probes.filter((p) => p.sentAt >= tTick - TEN_S && p.sentAt < tTick);
		if (window.length === 0) continue;

		// Last probe before this tick — this is the line we'll annotate
		let lastIdx = -1;
		for (let i = probes.length - 1; i >= 0; i--) {
			if (probes[i].sentAt < tTick) {
				lastIdx = i;
				break;
			}
		}
		if (lastIdx === -1) continue;

		// Compute stats from window
		const received = window.filter((p) => p.receivedAt !== null);
		const lost = window.length - received.length;
		const packetLossPercent = (lost / window.length) * 100;

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

		const avgLatencyMs = received.length > 0 ? latencySum / received.length : null;
		const avgJitterMs = received.length > 1 ? jitterSum / (received.length - 1) : null;
		const mos = calculateMosScore(avgLatencyMs, avgJitterMs, packetLossPercent);

		summaries.push({
			probeIndex: lastIdx,
			tTick,
			time: formatTime(tTick),
			mos,
			packetLossPercent,
			avgLatencyMs,
			avgJitterMs
		});
	}

	return summaries;
}
```

**Step 4: Run tests**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: All pass.

**Step 5: Commit**

```bash
git add analyze-cutie.ts tests/analyze-cutie.test.ts
git commit -m "feat: add computeSummaries with rolling 10s window"
```

---

## Task 5: `buildCsvLines` — assemble final output lines

**Files:**

- Modify: `analyze-cutie.ts`
- Modify: `tests/analyze-cutie.test.ts`

**Step 1: Write the failing test**

Add to `tests/analyze-cutie.test.ts`:

```typescript
import { buildCsvLines } from '../analyze-cutie';

describe('buildCsvLines', () => {
	it('emits headers, column header, probe lines, with summaries appended at correct index', () => {
		const headerLines = ['# cutie v0.2.25'];
		const probeLines: ProbeLine[] = [
			{ raw: '0,0,10', probe: { seq: 0, sentAt: 0, receivedAt: 10 } },
			{ raw: '1,100,110', probe: { seq: 1, sentAt: 100, receivedAt: 110 } }
		];
		const summaries: Summary[] = [
			{
				probeIndex: 1,
				tTick: 10000,
				time: '20:39:11',
				mos: 4.4,
				packetLossPercent: 0,
				avgLatencyMs: 10,
				avgJitterMs: 0
			}
		];

		const lines = buildCsvLines(headerLines, probeLines, summaries);

		expect(lines[0]).toBe('# cutie v0.2.25');
		expect(lines[1]).toBe(
			'seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms'
		);
		expect(lines[2]).toBe('0,0,10');
		expect(lines[3]).toBe('1,100,110,20:39:11,4.40,0.00,10.00,0.00');
	});

	it('outputs empty string for null summary values', () => {
		const headerLines: string[] = [];
		const probeLines: ProbeLine[] = [
			{ raw: '0,0,', probe: { seq: 0, sentAt: 0, receivedAt: null } }
		];
		const summaries: Summary[] = [
			{
				probeIndex: 0,
				tTick: 10000,
				time: '20:39:11',
				mos: null,
				packetLossPercent: 100,
				avgLatencyMs: null,
				avgJitterMs: null
			}
		];

		const lines = buildCsvLines(headerLines, probeLines, summaries);
		// column header + probe line
		expect(lines[1]).toBe('0,0,,20:39:11,,100.00,,');
	});
});
```

**Step 2: Run to confirm failure**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: FAIL — `buildCsvLines` not exported.

**Step 3: Add to `analyze-cutie.ts`**

```typescript
const fmt = (v: number | null): string => (v === null ? '' : v.toFixed(2));

export function buildCsvLines(
	headerLines: string[],
	probeLines: ProbeLine[],
	summaries: Summary[]
): string[] {
	const summaryByIndex = new Map<number, Summary>(summaries.map((s) => [s.probeIndex, s]));

	const lines: string[] = [
		...headerLines,
		'seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms'
	];

	for (let i = 0; i < probeLines.length; i++) {
		const s = summaryByIndex.get(i);
		if (s) {
			lines.push(
				`${probeLines[i].raw},${s.time},${fmt(s.mos)},${fmt(s.packetLossPercent)},${fmt(s.avgLatencyMs)},${fmt(s.avgJitterMs)}`
			);
		} else {
			lines.push(probeLines[i].raw);
		}
	}

	return lines;
}
```

**Step 4: Run tests**

```bash
npm test -- tests/analyze-cutie.test.ts
```

Expected: All pass.

**Step 5: Run the full test suite to make sure nothing is broken**

```bash
npm test
```

Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add analyze-cutie.ts tests/analyze-cutie.test.ts
git commit -m "feat: add buildCsvLines"
```

---

## Task 6: `main()` — wire it all together

**Files:**

- Modify: `analyze-cutie.ts`

**Step 1: Append `main()` to `analyze-cutie.ts`**

```typescript
function main(): void {
	const inputPath = process.argv[2];
	if (!inputPath) {
		console.error('Usage: analyze-cutie <file.cutie>');
		process.exit(1);
	}

	const absInput = resolve(inputPath);
	const compressed = readFileSync(absInput);
	const content = gunzipSync(compressed).toString('utf8');

	const { headerLines, probeLines } = parseCutieLines(content);
	const probes = probeLines.map((pl) => pl.probe);
	const summaries = computeSummaries(probes);
	const lines = buildCsvLines(headerLines, probeLines, summaries);

	const outputPath = absInput.replace(/\.cutie$/, '.csv');
	writeFileSync(outputPath, lines.join('\n') + '\n');
	console.log(`Written to ${outputPath}`);
}

main();
```

**Step 2: Test manually against a real `.cutie` file**

Run the app briefly to generate a `.cutie` file, then:

```bash
npx tsx analyze-cutie.ts ~/Downloads/Cutie_Results-*.cutie
```

Expected: `Written to ~/Downloads/Cutie_Results-*.csv`

**Step 3: Spot-check the CSV**

Open the `.csv` and verify:

- All `#` header lines at the top
- Column header line present
- Raw probe lines pass through (most with 3 fields only)
- Every ~100th line (last probe before a 10s tick) has 8 fields total
- `time` values are `HH:MM:SS` wall-clock times that match the session-start header

**Step 4: Commit**

```bash
git add analyze-cutie.ts
git commit -m "feat: wire up main() for analyze-cutie"
```

---

## Task 7: Make executable and install

**Step 1: Make the script executable**

```bash
chmod +x /Users/richb/github/Cutie-Network-Quality-Test/analyze-cutie.ts
```

**Step 2: Symlink into ~/bin**

```bash
ln -sf /Users/richb/github/Cutie-Network-Quality-Test/analyze-cutie.ts ~/bin/analyze-cutie
```

**Step 3: Verify from anywhere**

```bash
cd ~
analyze-cutie path/to/file.cutie
```

Expected: `Written to path/to/file.csv`

**Step 4: Final commit**

```bash
cd /Users/richb/github/Cutie-Network-Quality-Test
git add analyze-cutie.ts
git commit -m "feat: analyze-cutie complete — install to ~/bin"
```
