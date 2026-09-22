import { describe, it, expect } from 'vitest';
import { isSafari } from '../src/lib/browser-detect';

describe('isSafari', () => {
	it('recognizes a real Safari user agent', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15';
		expect(isSafari(ua)).toBe(true);
	});

	it('rejects Chrome, which also carries "Safari" in its user agent', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
		expect(isSafari(ua)).toBe(false);
	});

	it('rejects Edge, which also carries "Safari" and "Chrome" in its user agent', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
		expect(isSafari(ua)).toBe(false);
	});

	it('rejects Firefox', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0';
		expect(isSafari(ua)).toBe(false);
	});

	it('rejects a null user agent', () => {
		expect(isSafari(null)).toBe(false);
	});
});
