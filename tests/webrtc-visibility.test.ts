import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Unit tests for isMobile() using jsdom's navigator
describe('isMobile()', () => {
	const setNavigator = (maxTouchPoints: number, userAgent: string) => {
		Object.defineProperty(navigator, 'maxTouchPoints', {
			get: () => maxTouchPoints,
			configurable: true
		});
		Object.defineProperty(navigator, 'userAgent', {
			get: () => userAgent,
			configurable: true
		});
	};

	it('returns true for Android Chrome', async () => {
		setNavigator(5, 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(true);
	});

	it('returns true for iPhone Safari', async () => {
		setNavigator(
			5,
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1'
		);
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(true);
	});

	it('returns false for desktop Chrome (no touch, no mobile UA)', async () => {
		setNavigator(
			0,
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
		);
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});

	it('returns false when maxTouchPoints is 0 even with mobile UA', async () => {
		setNavigator(0, 'Mozilla/5.0 (Linux; Android 13) Mobile Safari/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});

	it('returns false when UA has no mobile keyword even with touch points', async () => {
		setNavigator(5, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});
});

// Source-inspection tests — verify the visibility handling is wired up
describe('visibility stop — source checks', () => {
	const src = readFileSync('src/lib/webrtc.ts', 'utf8');

	it("includes 'sleep' in DisconnectReason type", () => {
		expect(src).toContain("'sleep'");
	});

	it('defines VISIBILITY_STOP_DELAY_MS constant', () => {
		expect(src).toContain('VISIBILITY_STOP_DELAY_MS');
	});

	it('tracks hiddenAt and probeCountAtHide', () => {
		expect(src).toContain('hiddenAt');
		expect(src).toContain('probeCountAtHide');
	});

	it('attaches and removes visibilitychange listener', () => {
		expect(src).toContain("'visibilitychange'");
		expect(src).toContain('addEventListener');
		expect(src).toContain('removeEventListener');
	});

	it('uses document.hidden to detect background', () => {
		expect(src).toContain('document.hidden');
	});

	it('contains mobile stop message', () => {
		expect(src).toContain('Cutie only works when visible');
	});

	it('contains non-mobile stop message', () => {
		expect(src).toContain('computer went to sleep');
	});
});
