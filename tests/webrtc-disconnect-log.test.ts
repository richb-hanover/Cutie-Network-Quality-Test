import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('unexpected disconnect logging', () => {
	it('source contains structured disconnect snapshot log', () => {
		const src = readFileSync('src/lib/webrtc.ts', 'utf8');
		expect(src).toContain('Unexpected disconnect');
		expect(src).toContain('iceConnectionState');
		expect(src).toContain('elapsedMs');
		expect(src).toContain('lastProbeSeq');
	});
});
