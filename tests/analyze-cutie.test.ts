import { describe, it, expect } from 'vitest';
import { formatTime } from '../analyze-cutie';

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
