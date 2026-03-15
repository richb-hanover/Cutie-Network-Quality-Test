import { describe, it, expect } from 'vitest';
import { formatTime } from '../analyze-cutie';
import { parseCutieLines, type ProbeLine } from '../analyze-cutie';
import { computeSummaries, type Summary } from '../analyze-cutie';
import type { RawProbe } from '../src/lib/session-file';

describe('formatTime', () => {
	it('formats a unix ms timestamp as HH:MM:SS', () => {
		const d = new Date();
		d.setHours(20, 39, 11, 0);
		const ms = d.getTime();
		expect(formatTime(ms)).toBe('20:39:11');
	});

	it('pads single-digit values', () => {
		const d = new Date();
		d.setHours(1, 2, 3, 0);
		const ms = d.getTime();
		expect(formatTime(ms)).toBe('01:02:03');
	});
});

describe('parseCutieLines', () => {
	it('splits header lines from probe data', () => {
		const input = [
			'# cutie v0.2.25',
			'# session-start: 2026-03-10 20:39:01',
			'#',
			'seq,sentAt,receivedAt',
			'0,1000,1012',
			'1,1100,1113',
			'2,1200,',
		].join('\n');

		const result = parseCutieLines(input);

		expect(result.headerLines).toEqual([
			'# cutie v0.2.25',
			'# session-start: 2026-03-10 20:39:01',
			'#',
		]);
		expect(result.probeLines).toEqual([
			{ raw: '0,1000,1012', probe: { seq: 0, sentAt: 1000, receivedAt: 1012 } },
			{ raw: '1,1100,1113', probe: { seq: 1, sentAt: 1100, receivedAt: 1113 } },
			{ raw: '2,1200,',     probe: { seq: 2, sentAt: 1200, receivedAt: null } },
		]);
	});
});

describe('computeSummaries', () => {
	it('computes one summary for 100 probes spanning 10s', () => {
		// 10 probes/s, all received 10ms after sent
		const probes: RawProbe[] = Array.from({ length: 100 }, (_, i) => ({
			seq: i,
			sentAt: i * 100,        // 0ms … 9900ms
			receivedAt: i * 100 + 10,
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
			{ seq: 0, sentAt: 0,     receivedAt: 10 },
			{ seq: 1, sentAt: 9000,  receivedAt: 9010 }, // last before tick at 10000
			{ seq: 2, sentAt: 13000, receivedAt: 13010 },
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
			{ seq: 0, sentAt: 0,     receivedAt: 10 },
			{ seq: 1, sentAt: 5000,  receivedAt: 5010 },
			{ seq: 2, sentAt: 25000, receivedAt: 25010 },
		];

		const summaries = computeSummaries(probes);

		expect(summaries).toHaveLength(2);
		expect(summaries[0].tTick).toBe(10000);  // origin=0, k=1
		expect(summaries[1].tTick).toBe(30000);  // k=3; k=2 window is empty
	});

	it('returns empty array for empty probe list', () => {
		expect(computeSummaries([])).toEqual([]);
	});
});
