import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	ingestLatencySamples,
	resetMosData,
	trimSessionDataAfter,
	loadSessionSummaries,
	tenSecondAverages,
	tenSecondMos,
	tenSecondSummaryHistory
} from '../src/lib/stores/mosStore';
import type { LatencySample } from '../src/lib/latency-probe';

const makeSample = (seq: number, timestampMs: number, latencyMs = 5): LatencySample => ({
	seq,
	sentAt: timestampMs - latencyMs,
	status: 'received',
	latencyMs,
	jitterMs: 1,
	at: '',
	timestampMs
});

describe('trimSessionDataAfter', () => {
	beforeEach(() => {
		resetMosData();
	});

	it('removes 10-second chart summaries at or after the cutoff', () => {
		loadSessionSummaries([
			{ seq: 0, sentAt: 0, receivedAt: 5 },
			{ seq: 1, sentAt: 20_000, receivedAt: 20_005 }
		]);
		expect(get(tenSecondSummaryHistory).map((s) => s.at)).toEqual([0, 20_000]);

		trimSessionDataAfter(10_000, 10_000);

		expect(get(tenSecondSummaryHistory).map((s) => s.at)).toEqual([0]);
	});

	it('recomputes the recent averages from only the samples before the cutoff', () => {
		ingestLatencySamples([makeSample(0, 1_000, 5), makeSample(1, 2_000, 55)]);

		trimSessionDataAfter(1_500, 1_500);

		// Only the 5 ms sample at 1_000 survives the trim.
		expect(get(tenSecondAverages).averageLatencyMs).toBe(5);
	});

	it('clears the recent averages entirely when nothing survives the cutoff', () => {
		ingestLatencySamples([makeSample(0, 1_000)]);

		trimSessionDataAfter(0, 0);

		expect(get(tenSecondAverages).averageLatencyMs).toBeNull();
		expect(get(tenSecondMos)).toBeNull();
	});

	it('only averages the last 10 seconds before the cutoff, not everything since the last tick', () => {
		// sampleHistory is only pruned to a 10 s window by the periodic tick (every 10 s),
		// so a trim landing between ticks can find much more than 10 s of history sitting
		// there. The recomputed "recent" average must still only cover the last 10 s.
		ingestLatencySamples([
			makeSample(0, 100_000 - 18_000, 999), // 18 s before the cutoff: outside the window
			makeSample(1, 100_000 - 1_000, 5) // 1 s before the cutoff: inside the window
		]);

		trimSessionDataAfter(100_000, 100_000);

		expect(get(tenSecondAverages).averageLatencyMs).toBe(5);
	});
});
