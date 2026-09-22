import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/rtc-client', () => ({ createServerConnection: vi.fn() }));
// The stats poller only schedules unrelated timers; it plays no part in these scenarios.
vi.mock('$lib/rtc-stats', () => ({ startStatsReporter: () => () => {} }));

import { createServerConnection } from '$lib/rtc-client';
import { connectToServer, disconnect, webrtcState, getRawProbes } from '$lib/webrtc';
import { BACKGROUND_STOP_MESSAGE } from '$lib/background-gap';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type ConnectionOptions = {
	onMessage?: (event: MessageEvent) => void | Promise<void>;
	onError?: (err: unknown) => void;
};

/** A data channel that echoes every probe, like the Cutie server, until frozen. */
class FakeChannel extends EventTarget {
	readyState: RTCDataChannelState = 'open';
	frozen = false;
	constructor(private options: ConnectionOptions) {
		super();
	}
	send(payload: string) {
		if (this.frozen) return;
		queueMicrotask(() => void this.options.onMessage?.({ data: payload } as MessageEvent));
	}
	close() {
		this.readyState = 'closed';
	}
}

let hidden = false;
function setHidden(value: boolean) {
	hidden = value;
	document.dispatchEvent(new Event('visibilitychange'));
}

let channel: FakeChannel;
let options: ConnectionOptions;

async function startSession() {
	vi.mocked(createServerConnection).mockImplementation((async (opts: ConnectionOptions) => {
		options = opts;
		channel = new FakeChannel(opts);
		return {
			peerConnection: Object.assign(new EventTarget(), {
				connectionState: 'connected',
				iceConnectionState: 'connected'
			}),
			dataChannel: channel,
			connectionId: 'test-connection',
			close: async () => {}
		};
	}) as unknown as typeof createServerConnection);
	await connectToServer();
	await vi.advanceTimersByTimeAsync(1_000); // a second of normal probing
}

describe('page hidden and shown again', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		hidden = false;
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
	});

	afterEach(async () => {
		await disconnect('manual', { suppressMessage: true });
		vi.useRealTimers();
	});

	it('keeps collecting when probes kept arriving while hidden', async () => {
		await startSession();
		setHidden(true);
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);

		const state = get(webrtcState);
		expect(state.connection).not.toBeNull();
		expect(state.activeDisconnectReason).toBeNull();
		// Nothing was trimmed: probes sent well after the hide are still there.
		expect(getRawProbes().some((p) => p.sentAt > Date.now() - 60_000)).toBe(true);
	});

	it('stops with the background message and trims probes sent after the hide, when the page was frozen while hidden', async () => {
		await startSession();
		const hideStartAt = Date.now();
		setHidden(true);
		channel.frozen = true;
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.connection).toBeNull();
		expect(state.activeDisconnectReason).toBe('background');
		expect(state.errorMessage).toBe(BACKGROUND_STOP_MESSAGE);
		expect(getRawProbes().length).toBeGreaterThan(0);
		expect(getRawProbes().every((p) => p.sentAt < hideStartAt)).toBe(true);
	});

	it('stops with the two-hour message when shown again after two hours, even if timers were frozen', async () => {
		await startSession();
		setHidden(true);
		// A frozen page never ran its two-hour timer; only the clock moved.
		vi.setSystemTime(Date.now() + TWO_HOURS_MS + 60_000);
		setHidden(false);
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.activeDisconnectReason).toBe('auto');
		expect(state.collectionStatusMessage).toBe('Collection stopped after two hours.');
		expect(state.connection).toBeNull();
	});

	it('reports the two-hour stop, not a background stop, when the lost connection is noticed first on wake-up', async () => {
		await startSession();
		setHidden(true);
		vi.setSystemTime(Date.now() + TWO_HOURS_MS + 60_000);
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.collectionStatusMessage).toBe('Collection stopped after two hours.');
		expect(state.errorMessage).toBe('');
	});

	it('stops with the background message when the connection fails while hidden', async () => {
		await startSession();
		const hideStartAt = Date.now();
		setHidden(true);
		vi.setSystemTime(Date.now() + 185_000);
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.activeDisconnectReason).toBe('background');
		expect(state.errorMessage).toBe(BACKGROUND_STOP_MESSAGE);
		expect(getRawProbes().every((p) => p.sentAt < hideStartAt)).toBe(true);
	});

	it('trims back to when the hide began, not to when it became visible again, if the connection fails shortly after waking', async () => {
		await startSession();
		const hideStartAt = Date.now();
		setHidden(true);
		// Not frozen: probes keep arriving well above the stop threshold, so becoming
		// visible again does not trigger a stop on its own — this mirrors "kept
		// collecting" above, except the connection then fails a few seconds later.
		await vi.advanceTimersByTimeAsync(35_000);
		setHidden(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(get(webrtcState).connection).not.toBeNull(); // sanity: no stop yet

		await vi.advanceTimersByTimeAsync(5_000); // still inside the background grace window
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.activeDisconnectReason).toBe('background');
		expect(state.errorMessage).toBe(BACKGROUND_STOP_MESSAGE);
		expect(getRawProbes().every((p) => p.sentAt < hideStartAt)).toBe(true);
	});

	it('keeps the plain error message when the connection fails while the page is visible', async () => {
		await startSession();
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.errorMessage).toBe('Lost connection to the server...');
		expect(state.activeDisconnectReason).toBe('error');
	});
});
