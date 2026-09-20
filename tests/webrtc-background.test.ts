import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/rtc-client', () => ({ createServerConnection: vi.fn() }));
// The stats poller only schedules unrelated timers; it plays no part in these scenarios.
vi.mock('$lib/rtc-stats', () => ({ startStatsReporter: () => () => {} }));

import { createServerConnection } from '$lib/rtc-client';
import { connectToServer, disconnect, webrtcState } from '$lib/webrtc';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const NOTICE_TEXT = 'Some samples were not collected while Cutie was in the background';

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

	it('keeps collecting and shows no notice when probes kept arriving while hidden', async () => {
		await startSession();
		setHidden(true);
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);

		const state = get(webrtcState);
		expect(state.connection).not.toBeNull();
		expect(state.activeDisconnectReason).toBeNull();
		expect(state.samplesNotice).toBeNull();
	});

	it('keeps the session and shows the notice when the page was frozen while hidden', async () => {
		await startSession();
		setHidden(true);
		channel.frozen = true;
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);

		const state = get(webrtcState);
		expect(state.connection).not.toBeNull();
		expect(state.activeDisconnectReason).toBeNull();
		expect(state.samplesNotice).toBe(NOTICE_TEXT);
	});

	it('removes the notice 15 s after it appeared', async () => {
		await startSession();
		setHidden(true);
		channel.frozen = true;
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);

		await vi.advanceTimersByTimeAsync(14_999);
		expect(get(webrtcState).samplesNotice).toBe(NOTICE_TEXT);
		await vi.advanceTimersByTimeAsync(1);
		expect(get(webrtcState).samplesNotice).toBeNull();
	});

	it('removes the notice when the user stops the session', async () => {
		await startSession();
		setHidden(true);
		channel.frozen = true;
		await vi.advanceTimersByTimeAsync(120_000);
		setHidden(false);
		expect(get(webrtcState).samplesNotice).toBe(NOTICE_TEXT);

		await disconnect('manual');
		expect(get(webrtcState).samplesNotice).toBeNull();
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

	it('reports the two-hour stop, not an error, when the lost connection is noticed first on wake-up', async () => {
		await startSession();
		setHidden(true);
		vi.setSystemTime(Date.now() + TWO_HOURS_MS + 60_000);
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.collectionStatusMessage).toBe('Collection stopped after two hours.');
		expect(state.errorMessage).toBe('');
	});

	it('says the connection was lost in the background when it fails while hidden', async () => {
		await startSession();
		setHidden(true);
		vi.setSystemTime(Date.now() + 185_000);
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		const state = get(webrtcState);
		expect(state.errorMessage).toBe(
			'Lost connection to the server while Cutie was in the background'
		);
		expect(state.collectionStatusMessage).toBeNull();
	});

	it('keeps the plain message when the connection fails while the page is visible', async () => {
		await startSession();
		options.onError?.(new Error('Lost connection to the server...'));
		await vi.advanceTimersByTimeAsync(0);

		expect(get(webrtcState).errorMessage).toBe('Lost connection to the server...');
	});
});
