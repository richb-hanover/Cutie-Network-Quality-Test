import { derived, get, writable } from 'svelte/store';
import {
	initializeLatencyMonitor,
	createEmptyLatencyStats,
	type LatencyStats
} from '$lib/latency-probe';
import { createServerConnection, type ServerConnection } from '$lib/rtc-client';
import { startStatsReporter, type StatsSummary } from '$lib/rtc-stats';
import {
	calculateMosScore,
	ingestLatencySamples,
	resetMosData,
	updateMosLatencyStats,
	tenSecondAverages,
	tenSecondMos,
	loadRecentAverages,
	loadSessionSummaries,
	trimSessionDataAfter
} from '$lib/stores/mosStore';
import {
	formatCutieFile,
	downloadCutieFile,
	parseCutieFile,
	formatLocalDateTime,
	type SessionBounds,
	type SessionFileData
} from '$lib/session-file';
import { get as getStore } from 'svelte/store';
import { getLogger } from './logger';
import {
	BACKGROUND_STOP_MESSAGE,
	applyTwoHourRule,
	shouldStopForBackground,
	wasInBackground
} from './background-gap';

const logger = getLogger('webrtc');

export type DisconnectReason = 'manual' | 'timeout' | 'error' | 'auto' | 'reload' | 'background';

export type MessageEntry = {
	id: number;
	direction: 'in' | 'out';
	payload: string;
	at: string;
};

export type WebRtcState = {
	connection: ServerConnection | null;
	connectionId: string | null;
	connectionState: RTCPeerConnectionState;
	iceConnectionState: RTCIceConnectionState;
	dataChannelState: RTCDataChannelState;
	statsSummary: StatsSummary | null;
	isConnecting: boolean;
	errorMessage: string;
	messages: MessageEntry[];
	latencyStats: LatencyStats;
	collectionStatusMessage: string | null;
	collectionStartAt: number | null;
	collectionEndAt: number | null;
	activeDisconnectReason: DisconnectReason | null;
	isDisconnecting: boolean;
};

const initialState: WebRtcState = {
	connection: null,
	connectionId: null,
	connectionState: 'disconnected',
	iceConnectionState: 'new',
	dataChannelState: 'closed',
	statsSummary: null,
	isConnecting: false,
	errorMessage: '',
	messages: [],
	latencyStats: createEmptyLatencyStats(),
	collectionStatusMessage: null,
	collectionStartAt: null,
	collectionEndAt: null,
	activeDisconnectReason: null,
	isDisconnecting: false
};

const COLLECTION_DURATION_MS = 2 * 60 * 60 * 1000;

export const webrtcState = writable<WebRtcState>(initialState);

export const connectionIdStore = derived(webrtcState, (state) => state.connectionId);

const textDecoder = new TextDecoder();
let stopStats: (() => void) | null = null;
let collectionAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
let messageId = 0;
let rawProbes: Array<{ seq: number; sentAt: number; receivedAt: number | null }> = [];
let epochOffsetMs = 0; // Date.now() - performance.now() at session start
// Page visibility bookkeeping (see handleVisibilityChange)
let hiddenAt: number | null = null; // when the page was hidden; null while visible
let receivedAtHide: number | null = null; // totalReceived at that moment
let lastShownAt: number | null = null; // when the page last became visible again
// When the most recent hide started. Unlike hiddenAt, this is NOT cleared on becoming
// visible again — it stays available for the rest of the background grace window, so a
// connection failure that surfaces just after waking still trims back to the true start
// of the hide, not to the moment the page happened to wake up.
let lastHideStartedAt: number | null = null;

const latencyProbe = initializeLatencyMonitor({
	onStats: (stats) => {
		const snapshot = { ...stats, history: [] };
		webrtcState.update((state) => ({ ...state, latencyStats: snapshot }));
		updateMosLatencyStats(snapshot);
	},
	onSamples: (samples) => {
		ingestLatencySamples(samples);
		for (const s of samples) {
			rawProbes.push({
				seq: s.seq,
				sentAt: Math.round(s.sentAt + epochOffsetMs),
				receivedAt: s.latencyMs !== null ? Math.round(s.sentAt + s.latencyMs + epochOffsetMs) : null
			});
		}
	}
});

function clearCollectionAutoStopTimer(): void {
	if (collectionAutoStopTimer) {
		clearTimeout(collectionAutoStopTimer);
		collectionAutoStopTimer = null;
	}
}

function scheduleCollectionAutoStop(): void {
	clearCollectionAutoStopTimer();
	collectionAutoStopTimer = setTimeout(() => {
		const { connection, isDisconnecting } = get(webrtcState);
		collectionAutoStopTimer = null;
		if (connection && !isDisconnecting) {
			void disconnect('auto');
		}
	}, COLLECTION_DURATION_MS);
}

/**
 * trimBackgroundData() - discard everything from cutoffMs (when the responsible hide
 * started) onward: the raw probes behind the .cutie save file and the chart history.
 * So only the good, pre-hide data is shown or saved. The running totals in the
 * Latency Monitor panel are left alone; they are diagnostic, not part of the trimmed
 * story.
 */
function trimBackgroundData(cutoffMs: number): void {
	rawProbes = rawProbes.filter((probe) => probe.sentAt < cutoffMs);
	trimSessionDataAfter(cutoffMs, cutoffMs - epochOffsetMs);
}

/**
 * stopForBackground() - stop collection because Cutie was in the background: too few
 * probes arrived while hidden, or the connection itself failed while hidden (or just
 * after waking, within the background grace window).
 */
function stopForBackground(cutoffMs: number): void {
	trimBackgroundData(cutoffMs);
	void disconnect('background', { message: BACKGROUND_STOP_MESSAGE, endAt: cutoffMs });
}

/**
 * Where a background stop should cut off: the start of whichever hide is responsible.
 * Valid only when wasInBackground() is true — that's guaranteed to have set
 * lastHideStartedAt, either just now (still hidden) or on the most recent hide (within
 * the grace window after waking). The Date.now() fallback never actually applies then;
 * it exists so this can't return null.
 */
function backgroundStopCutoffMs(): number {
	return lastHideStartedAt ?? Date.now();
}

/** Reasons meaning a disconnect is already under way or finished. */
const HANDLED_DISCONNECT_REASONS: ReadonlySet<DisconnectReason> = new Set([
	'manual',
	'error',
	'auto',
	'background'
]);

/**
 * isUnhandledDisconnect() - true when a "the connection just went away unexpectedly"
 * handler (onError, dataChannel close/error) should still act: nothing has already
 * claimed this disconnect. `extra` covers a handler-specific reason to also treat as
 * already handled (the dataChannel 'error' handler also skips 'timeout').
 */
function isUnhandledDisconnect(
	reason: DisconnectReason | null,
	extra: readonly DisconnectReason[] = []
): boolean {
	if (reason === null) {
		return true;
	}
	return !HANDLED_DISCONNECT_REASONS.has(reason) && !extra.includes(reason);
}

/**
 * handleVisibilityChange() - remember when the page is hidden; on return, apply the
 * two-hour limit, then stop collection if so few probes arrived while hidden that the
 * data since is useless. Short hides, and hides where Chrome/Edge/Firefox kept
 * probing near their throttled rate, never stop the session.
 */
function handleVisibilityChange(): void {
	const now = Date.now();
	const { latencyStats } = get(webrtcState);

	if (document.hidden) {
		hiddenAt = now;
		lastHideStartedAt = now;
		receivedAtHide = latencyStats.totalReceived;
		return;
	}

	const hiddenMs = hiddenAt !== null ? now - hiddenAt : 0;
	const receivedWhileHidden =
		receivedAtHide !== null ? latencyStats.totalReceived - receivedAtHide : 0;
	logger.info(
		`Visible again after ${(hiddenMs / 1000).toFixed(1)}s hidden: ` +
			`received ${receivedWhileHidden} probes (about ${Math.round(hiddenMs / 1000)} expected when throttled)`
	);
	hiddenAt = null;
	receivedAtHide = null;
	lastShownAt = now;

	const { connection, isDisconnecting, collectionStartAt } = get(webrtcState);
	if (!connection || isDisconnecting) {
		return;
	}
	if (collectionStartAt !== null && now - collectionStartAt >= COLLECTION_DURATION_MS) {
		// The two-hour message always wins over the background one, but a hide that was
		// itself useless (e.g. a lid closed for hours before the page ever woke up to
		// notice) should still be trimmed, the same as an ordinary background stop.
		if (shouldStopForBackground(hiddenMs, receivedWhileHidden)) {
			const cutoffMs = backgroundStopCutoffMs();
			trimBackgroundData(cutoffMs);
			void disconnect('auto', { endAt: cutoffMs });
		} else {
			void disconnect('auto');
		}
		return;
	}
	if (shouldStopForBackground(hiddenMs, receivedWhileHidden)) {
		stopForBackground(backgroundStopCutoffMs());
	}
}

function beginCollectionSession(dataChannel: RTCDataChannel): void {
	epochOffsetMs = Date.now() - performance.now();
	const startAt = Date.now();
	webrtcState.update((state) => ({
		...state,
		collectionStartAt: startAt,
		collectionEndAt: null,
		activeDisconnectReason: null,
		collectionStatusMessage: null
	}));
	scheduleCollectionAutoStop();
	latencyProbe.start(dataChannel);

	hiddenAt = null;
	receivedAtHide = null;
	lastShownAt = null;
	lastHideStartedAt = null;
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', handleVisibilityChange);
	}
}

async function normaliseDataMessage(data: unknown): Promise<string> {
	if (typeof data === 'string') {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return textDecoder.decode(data);
	}
	if (ArrayBuffer.isView(data)) {
		return textDecoder.decode(data as ArrayBufferView);
	}
	if (typeof Blob !== 'undefined' && data instanceof Blob) {
		const buffer = await data.arrayBuffer();
		return textDecoder.decode(buffer);
	}
	if (data === null || data === undefined) {
		return '';
	}
	return String(data);
}

export async function connectToServer(): Promise<void> {
	const state = get(webrtcState);
	if (state.isConnecting) {
		return;
	}

	logger.info(`Clicked Start button`);
	webrtcState.update((current) => ({
		...current,
		isConnecting: true,
		connectionId: null,
		errorMessage: '',
		collectionStatusMessage: null,
		collectionStartAt: null,
		statsSummary: null,
		latencyStats: createEmptyLatencyStats(),
		activeDisconnectReason: null
	}));

	clearCollectionAutoStopTimer();
	rawProbes = [];
	epochOffsetMs = 0;
	resetMosData();

	try {
		if (state.connection) {
			await disconnect('manual', { suppressMessage: true });
			webrtcState.update((current) => ({ ...current, activeDisconnectReason: null }));
		}

		const connection = await createServerConnection({
			onMessage: async (event: MessageEvent) => {
				const payload = await normaliseDataMessage(event.data);
				if (latencyProbe.handleMessage(payload)) {
					return;
				}

				webrtcState.update((current) => ({
					...current,
					messages: [
						...current.messages,
						{
							id: ++messageId,
							direction: 'in',
							payload,
							at: new Date().toLocaleTimeString(),
							connectionId: current.connectionId
						}
					]
				}));
			},
			onOpen: () => {
				webrtcState.update((current) => ({
					...current,
					dataChannelState: connection.dataChannel.readyState
				}));
			},
			onError: (err: unknown) => {
				const raw = err instanceof Error ? err.message : String(err);
				const message = raw.includes('network is down')
					? "Can't connect to the server when the network is down"
					: raw;
				latencyProbe.stop();
				const { activeDisconnectReason } = get(webrtcState);
				if (isUnhandledDisconnect(activeDisconnectReason)) {
					if (wasInBackground({ hiddenAt, lastShownAt, now: Date.now() })) {
						stopForBackground(backgroundStopCutoffMs());
					} else {
						webrtcState.update((current) => ({ ...current, errorMessage: message }));
						void disconnect('error', { message });
					}
				}
			}
		});

		const { peerConnection, dataChannel } = connection;

		webrtcState.update((current) => ({
			...current,
			connection,
			connectionId: connection.connectionId,
			connectionState: peerConnection.connectionState,
			iceConnectionState: peerConnection.iceConnectionState,
			dataChannelState: dataChannel.readyState
		}));

		peerConnection.addEventListener('connectionstatechange', () => {
			webrtcState.update((current) => ({
				...current,
				connectionState: peerConnection.connectionState
			}));
			if (
				peerConnection.connectionState === 'failed' ||
				peerConnection.connectionState === 'disconnected'
			) {
				const snap = get(webrtcState);
				const elapsedMs = snap.collectionStartAt ? Date.now() - snap.collectionStartAt : null;
				logger.info(
					`[webrtc] Peer connection ${peerConnection.connectionState} — ` +
						`iceConnectionState=${peerConnection.iceConnectionState} ` +
						`dataChannelState=${dataChannel.readyState} ` +
						`lastProbeSeq=${snap.latencyStats.totalReceived} ` +
						`elapsedMs=${elapsedMs}`
				);
			}
		});

		peerConnection.addEventListener('iceconnectionstatechange', () => {
			webrtcState.update((current) => ({
				...current,
				iceConnectionState: peerConnection.iceConnectionState
			}));
		});

		dataChannel.addEventListener('open', () => {
			logger.info('dataChannel opened');
			webrtcState.update((current) => ({
				...current,
				dataChannelState: dataChannel.readyState
			}));
			beginCollectionSession(dataChannel);
		});

		dataChannel.addEventListener('close', () => {
			logger.info(`dataChannel closed: ${get(webrtcState).activeDisconnectReason}`);
			webrtcState.update((current) => ({
				...current,
				dataChannelState: dataChannel.readyState
			}));
			latencyProbe.stop();
			const { activeDisconnectReason } = get(webrtcState);
			if (isUnhandledDisconnect(activeDisconnectReason)) {
				const snap = get(webrtcState);
				const elapsedMs = snap.collectionStartAt ? Date.now() - snap.collectionStartAt : null;
				logger.info(
					`[webrtc] Unexpected disconnect — ` +
						`connectionState=${peerConnection.connectionState} ` +
						`iceConnectionState=${peerConnection.iceConnectionState} ` +
						`dataChannelState=${dataChannel.readyState} ` +
						`lastProbeSeq=${snap.latencyStats.totalReceived} ` +
						`totalSent=${snap.latencyStats.totalSent} ` +
						`totalLost=${snap.latencyStats.totalLost} ` +
						`elapsedMs=${elapsedMs}`
				);
				if (wasInBackground({ hiddenAt, lastShownAt, now: Date.now() })) {
					stopForBackground(backgroundStopCutoffMs());
				} else {
					void disconnect('timeout');
				}
			}
		});

		dataChannel.addEventListener('error', (e) => {
			logger.info(`dataChannel error: ${e}`);
			latencyProbe.stop();
			const message = e instanceof Error ? e.message : String(e);
			const { activeDisconnectReason } = get(webrtcState);
			if (isUnhandledDisconnect(activeDisconnectReason, ['timeout'])) {
				if (wasInBackground({ hiddenAt, lastShownAt, now: Date.now() })) {
					stopForBackground(backgroundStopCutoffMs());
				} else {
					void disconnect('error', { message });
				}
			}
		});

		if (dataChannel.readyState === 'open') {
			beginCollectionSession(dataChannel);
		}

		stopStats?.();
		stopStats = startStatsReporter(peerConnection, (summary: StatsSummary) => {
			webrtcState.update((current) => ({ ...current, statsSummary: summary }));
		});
	} catch (err) {
		logger.info(`dataChannel caught error: ${err}`);
		const raw = err instanceof Error ? err.message : String(err);
		const message = raw.includes('network is down')
			? "Can't connect to the server when the network is down"
			: raw;
		webrtcState.update((current) => ({
			...current,
			errorMessage: message,
			connectionState: 'failed'
		}));
		latencyProbe.stop();
		const { activeDisconnectReason } = get(webrtcState);
		if (isUnhandledDisconnect(activeDisconnectReason)) {
			await disconnect('error', { message });
		}
	} finally {
		webrtcState.update((current) => ({ ...current, isConnecting: false }));
	}
}

export async function disconnect(
	requestedReason: DisconnectReason = 'timeout',
	options: { message?: string; suppressMessage?: boolean; endAt?: number } = {}
): Promise<void> {
	const state = get(webrtcState);
	if (state.isDisconnecting) {
		return;
	}

	// A stop after the two-hour limit is reported as the two-hour stop, whichever
	// event (failed connection, closed channel, page shown) reached us first on wake-up.
	const elapsedMs = state.collectionStartAt !== null ? Date.now() - state.collectionStartAt : null;
	const reason = applyTwoHourRule(requestedReason, elapsedMs, COLLECTION_DURATION_MS);

	logger.info(`Clicked Stop button - reason: ${reason}`);

	webrtcState.update((current) => ({
		...current,
		isDisconnecting: true,
		activeDisconnectReason: reason
	}));

	latencyProbe.stop();
	stopStats?.();
	stopStats = null;
	clearCollectionAutoStopTimer();

	hiddenAt = null;
	receivedAtHide = null;
	lastShownAt = null;
	lastHideStartedAt = null;
	if (typeof document !== 'undefined') {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	}

	if (state.connection) {
		try {
			await state.connection.close();
		} catch (closeError) {
			console.error('Failed to close connection', closeError);
		}
	}

	let collectionStatusMessage = state.collectionStatusMessage;
	let errorMessage = state.errorMessage;

	if (!options.suppressMessage) {
		if (reason === 'manual') {
			collectionStatusMessage = 'Collection stopped manually';
		} else if (reason === 'timeout') {
			const referenceStart = state.collectionStartAt ?? Date.now();
			const elapsedMs = Date.now() - referenceStart;
			const minutes = Math.max(1, Math.ceil(elapsedMs / 60000));
			collectionStatusMessage = `Collection stopped after ${minutes} minute${
				minutes === 1 ? '' : 's'
			}`;
		} else if (reason === 'auto') {
			collectionStatusMessage = 'Collection stopped after two hours.';
		}
	}

	if ((reason === 'error' || reason === 'background') && options.message) {
		errorMessage = options.message;
	} else if (reason !== 'error') {
		errorMessage = '';
	}

	resetMosData({ clearHistory: false });

	webrtcState.update((current) => ({
		...current,
		connection: null,
		connectionState: 'disconnected',
		iceConnectionState: 'new',
		dataChannelState: 'closed',
		collectionStatusMessage,
		collectionEndAt: options.suppressMessage
			? current.collectionEndAt
			: (options.endAt ?? Date.now()),
		errorMessage,
		isDisconnecting: false
	}));
}

export function sendMessage(outgoingMessage: string): boolean {
	const trimmed = outgoingMessage.trim();
	const state = get(webrtcState);
	if (!state.connection || !trimmed) {
		return false;
	}

	logger.info(`Sending message: "${outgoingMessage}"`);

	state.connection.dataChannel.send(trimmed);

	webrtcState.update((current) => ({
		...current,
		messages: [
			...current.messages,
			{
				id: ++messageId,
				direction: 'out',
				payload: trimmed,
				at: new Date().toLocaleTimeString()
			}
		]
	}));

	return true;
}

export function getRawProbes(): Array<{ seq: number; sentAt: number; receivedAt: number | null }> {
	return rawProbes;
}

export function getEpochOffsetMs(): number {
	return epochOffsetMs;
}

function getClientInfo(): string | null {
	if (typeof navigator === 'undefined') return null;
	return navigator.userAgent || null;
}

export async function saveSession(bounds: SessionBounds, version: string): Promise<void> {
	const state = get(webrtcState);
	if (!state.collectionStartAt) return;

	const durationMs = (state.collectionEndAt ?? Date.now()) - state.collectionStartAt;
	const totalPacketLossPercent =
		state.latencyStats.totalSent > 0
			? (state.latencyStats.totalLost / state.latencyStats.totalSent) * 100
			: null;
	const mosInstant = calculateMosScore(
		state.latencyStats.lastLatencyMs,
		state.latencyStats.jitterMs,
		totalPacketLossPercent
	);

	const backendAddress =
		typeof window !== 'undefined' && window.location.host ? window.location.host : null;
	const guiComputer = getClientInfo();

	const data: SessionFileData = {
		version,
		sessionStartMs: state.collectionStartAt,
		connectionId: state.connectionId,
		backendAddress,
		guiComputer,
		durationMs,
		latencyStats: state.latencyStats,
		bounds,
		tenSecondAverages: getStore(tenSecondAverages),
		tenSecondMos: getStore(tenSecondMos),
		mosInstant,
		bytesSent: state.statsSummary?.bytesSent ?? 0,
		probes: rawProbes
	};

	const content = formatCutieFile(data);
	await downloadCutieFile(content, state.collectionStartAt);
}

export async function loadSession(content: string): Promise<SessionFileData | null> {
	let data: SessionFileData;
	try {
		data = parseCutieFile(content);
	} catch {
		return null;
	}

	// Stop any live session first
	const state = get(webrtcState);
	if (state.connection || state.isConnecting) {
		await disconnect('manual', { suppressMessage: true });
	}

	// Clear accumulated probes
	rawProbes = [];
	epochOffsetMs = 0;
	resetMosData();

	// Synthetic statsSummary for Long-term Statistics panel
	const syntheticStats = {
		timestamp: data.sessionStartMs + data.durationMs,
		bytesSent: data.bytesSent,
		bytesReceived: 0,
		packetsSent: 0,
		packetsReceived: 0,
		messagesSent: 0,
		messagesReceived: 0,
		currentRoundTripTime: null
	};

	// Synthetic "Reloaded" message
	const reloadedPayload = JSON.stringify({
		type: 'Reloaded',
		sessionStart: formatLocalDateTime(data.sessionStartMs),
		connectionId: data.connectionId,
		backendAddress: data.backendAddress,
		durationMs: data.durationMs
	});

	webrtcState.update(() => ({
		...initialState,
		latencyStats: data.latencyStats,
		collectionStartAt: data.sessionStartMs,
		collectionEndAt: data.sessionStartMs + data.durationMs,
		connectionId: data.connectionId,
		statsSummary: syntheticStats,
		messages: [
			{
				id: ++messageId,
				direction: 'in',
				payload: reloadedPayload,
				at: formatLocalDateTime(data.sessionStartMs)
			}
		]
	}));

	// Populate charts from raw probe data
	loadSessionSummaries(data.probes);
	loadRecentAverages(data.tenSecondAverages, data.tenSecondMos);

	return data; // caller uses data.bounds to update LatencyMonitorPanel
}
