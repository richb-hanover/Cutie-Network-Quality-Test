import { describe, it, expect } from 'vitest';
import {
	formatCutieFile,
	parseCutieFile,
	cutieFilename,
	type SessionFileData
} from '../src/lib/session-file';

const makeSampleData = (): SessionFileData => ({
	version: '0.2.21',
	sessionStartMs: 1741234500000,
	connectionId: 'test-conn-123',
	backendAddress: 'localhost:5173',
	durationMs: 300000,
	latencyStats: {
		lastLatencyMs: 28.3,
		averageLatencyMs: 31.2,
		jitterMs: 2.1,
		totalSent: 3000,
		totalReceived: 2995,
		totalLost: 5,
		history: []
	},
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
	mosInstant: 4.2,
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
		expect(parsed.backendAddress).toBe(original.backendAddress);
		expect(parsed.durationMs).toBe(original.durationMs);
		expect(parsed.latencyStats.lastLatencyMs).toBeCloseTo(original.latencyStats.lastLatencyMs!, 2);
		expect(parsed.latencyStats.jitterMs).toBeCloseTo(original.latencyStats.jitterMs!, 2);
		expect(parsed.latencyStats.totalSent).toBe(original.latencyStats.totalSent);
		expect(parsed.latencyStats.totalLost).toBe(original.latencyStats.totalLost);
		expect(parsed.tenSecondAverages.averageLatencyMs).toBeCloseTo(
			original.tenSecondAverages.averageLatencyMs!,
			2
		);
		expect(parsed.tenSecondAverages.averageJitterMs).toBeCloseTo(
			original.tenSecondAverages.averageJitterMs!,
			2
		);
		expect(parsed.tenSecondAverages.packetLossPercent).toBeCloseTo(
			original.tenSecondAverages.packetLossPercent!,
			2
		);
		expect(parsed.tenSecondMos).toBeCloseTo(original.tenSecondMos!, 2);
		expect(parsed.mosInstant).toBeCloseTo(original.mosInstant!, 2);
		expect(parsed.bounds.latencyMs.min).toBeCloseTo(original.bounds.latencyMs.min!, 2);
		expect(parsed.bounds.mos.max).toBeCloseTo(original.bounds.mos.max!, 2);
		expect(parsed.bytesSent).toBe(original.bytesSent);
		expect(parsed.probes).toHaveLength(3);
		expect(parsed.probes[0]).toEqual({ seq: 0, sentAt: 1741234500100, receivedAt: 1741234500142 });
		expect(parsed.probes[2]).toEqual({ seq: 2, sentAt: 1741234500300, receivedAt: null });
	});

	it('formatted content has section headers and ISO date', () => {
		const content = formatCutieFile(makeSampleData());
		expect(content).toContain('# cutie v0.2.21');
		expect(content).toContain('# session-start: ');
		expect(content).toContain('# [latency-monitor]');
		expect(content).toContain('# [long-term-stats]');
		expect(content).toContain('seq,sentAt,receivedAt');
	});

	it('parseCutieFile throws on invalid content', () => {
		expect(() => parseCutieFile('not a cutie file')).toThrow();
	});

	it('cutieFilename produces correct format', () => {
		// Use a fixed UTC timestamp: 2026-03-09T08:30:00Z
		// Local time depends on timezone, so just check shape
		const name = cutieFilename(1741513800000);
		expect(name).toMatch(/^Cutie_Results-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.cutie$/);
	});
});
