import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// The server log shows when a Cutie window is hidden and shown again only if the page
// sends these beacons. jsdom has no navigator.sendBeacon, so lifecycle-beacon falls
// back to fetch, which we capture here.
type SentBeacon = { reason: string; visibilityState: string };
const sent: SentBeacon[] = [];

let visibilityState: DocumentVisibilityState = 'visible';
function changeVisibility(next: DocumentVisibilityState) {
	visibilityState = next;
	document.dispatchEvent(new Event('visibilitychange'));
}

describe('visibility beacons', () => {
	beforeAll(async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: { body: string }) => {
				const payload = JSON.parse(init.body);
				sent.push({ reason: payload.reason, visibilityState: payload.visibilityState });
				return { ok: true };
			})
		);
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => visibilityState
		});
		await import('../src/lib/lifecycle-beacon'); // sends 'init' as it loads
	});

	beforeEach(() => {
		sent.length = 0;
	});

	it('tells the server when the page is hidden', () => {
		changeVisibility('hidden');

		expect(sent).toEqual([{ reason: 'visibility-hidden', visibilityState: 'hidden' }]);
	});

	it('tells the server when the page becomes visible again', () => {
		changeVisibility('visible');

		expect(sent).toEqual([{ reason: 'visibility-visible', visibilityState: 'visible' }]);
	});
});
