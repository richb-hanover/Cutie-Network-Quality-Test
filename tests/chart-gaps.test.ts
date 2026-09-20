import { describe, it, expect } from 'vitest';
import { gapAwareSegment } from '../src/lib/chart-gaps';

// A chart point normally arrives every 10 s. When the page was hidden or frozen, the next
// point can be many minutes later, and the line must not join the two as if the network
// had been measured in between (a flat "Excellent" line, or a loss ramp to 20%).
// x values are seconds, as on the chart's x axis.
function lineColorBetween(x0: number | null, x1: number | null): unknown {
	const segment = { p0: { parsed: { x: x0 } }, p1: { parsed: { x: x1 } } };
	return gapAwareSegment.borderColor(segment as never);
}

describe('gapAwareSegment', () => {
	it('keeps the line between points that are the usual 10 s apart', () => {
		expect(lineColorBetween(100, 110)).toBeUndefined();
	});

	it('keeps the line for a gap of exactly 30 s (three missed points)', () => {
		expect(lineColorBetween(100, 130)).toBeUndefined();
	});

	it('hides the line for a gap just over 30 s', () => {
		expect(lineColorBetween(100, 130.001)).toBe('transparent');
	});

	it('keeps the line when a point has no x value (Chart.js allows null)', () => {
		expect(lineColorBetween(null, 500)).toBeUndefined();
		expect(lineColorBetween(500, null)).toBeUndefined();
	});

	it('hides the line across a 36-minute hidden period', () => {
		expect(lineColorBetween(548, 548 + 2155)).toBe('transparent');
	});
});
