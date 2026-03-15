import { describe, it, expect } from 'vitest';
import { formatTime } from '../analyze-cutie';
import { parseCutieLines, type ProbeLine } from '../analyze-cutie';

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
