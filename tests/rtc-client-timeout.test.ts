import { describe, it, expect } from 'vitest';
import { ICE_GATHER_TIMEOUT_MS } from '../src/lib/rtc-client';

describe('ICE_GATHER_TIMEOUT_MS', () => {
	it('is 5000 ms', () => {
		expect(ICE_GATHER_TIMEOUT_MS).toBe(5_000);
	});
});
