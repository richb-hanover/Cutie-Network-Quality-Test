import { describe, it, expect } from 'vitest';
import { initializeLatencyMonitor } from '../src/lib/latency-probe';
import { ingestLatencySamples, updateMosLatencyStats } from '../src/lib/stores/mosStore';
import getLatencyMonitorStats from '../src/lib/components/LatencyMonitorPanel.svelte';

describe('injectLatencyInfo', () => {
	it('records a single probe and prints latency monitor stats', () => {
		const monitor = initializeLatencyMonitor({
			collectSamples: true,
			onStats: (stats) => {
				updateMosLatencyStats(stats);
			},
			onSamples: (samples) => {
				ingestLatencySamples(samples);
			}
		});

		monitor.injectLatencyInfo([{ seq: 0, sentAt: 0, receivedAt: 1 }]);

		const stats = getLatencyMonitorStats();
		console.log('Latency Monitor Stats:', stats);

		expect(stats.Latency[0]).toBe(1);
	});
});
