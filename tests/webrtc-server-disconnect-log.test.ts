import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('server disconnect logging', () => {
	it('ManagedConnection type includes tracking fields', () => {
		const src = readFileSync('src/lib/server/webrtcRegistry.ts', 'utf8');
		expect(src).toContain('deleteReceived');
		expect(src).toContain('openedAt');
		expect(src).toContain('lastMessageAt');
	});

	it('server source contains UNEXPECTED close log', () => {
		const src = readFileSync('src/routes/api/webrtc/+server.ts', 'utf8');
		expect(src).toContain('UNEXPECTED');
		expect(src).toContain('openDurationMs');
		expect(src).toContain('lastMessageAt');
	});
});
