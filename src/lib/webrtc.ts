import { derived, get, writable } from 'svelte/store';
import {
	initializeLatencyMonitor,
	createEmptyLatencyStats,
	type LatencyStats
} from '$lib/latency-probe';
import { createServerConnection, type ServerConnection } from '$lib/rtc-client';
import { startStatsReporter, type StatsSummary } from '$lib/rtc-stats';
import { ingestLatencySamples, resetMosData, updateMosLatencyStats } from '$lib/stores/mosStore';
import { getLogger } from './logger';

const logger = getLogger('webrtc');

export type DisconnectReason = 'manual' | 'timeout' | 'error' | 'auto' | 'reload';

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
				const message = err instanceof Error ? err.message : String(err);
				webrtcState.update((current) => ({ ...current, errorMessage: message }));
				latencyProbe.stop();
				const { activeDisconnectReason } = get(webrtcState);
				if (
					activeDisconnectReason !== 'manual' &&
					activeDisconnectReason !== 'error' &&
					activeDisconnectReason !== 'auto'
				) {
					void disconnect('error', { message });
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
			if (
				activeDisconnectReason !== 'manual' &&
				activeDisconnectReason !== 'error' &&
				activeDisconnectReason !== 'auto'
			) {
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
				void disconnect('timeout');
			}
		});

		dataChannel.addEventListener('error', (e) => {
			logger.info(`dataChannel error: ${e}`);
			latencyProbe.stop();
			const message = e instanceof Error ? e.message : String(e);
			const { activeDisconnectReason } = get(webrtcState);
			if (
				activeDisconnectReason !== 'manual' &&
				activeDisconnectReason !== 'timeout' &&
				activeDisconnectReason !== 'error' &&
				activeDisconnectReason !== 'auto'
			) {
				void disconnect('error', { message });
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
		const message = err instanceof Error ? err.message : String(err);
		webrtcState.update((current) => ({
			...current,
			errorMessage: message,
			connectionState: 'failed'
		}));
		latencyProbe.stop();
		const { activeDisconnectReason } = get(webrtcState);
		if (activeDisconnectReason !== 'manual' && activeDisconnectReason !== 'error') {
			await disconnect('error', { message });
		}
	} finally {
		webrtcState.update((current) => ({ ...current, isConnecting: false }));
	}
}

export async function disconnect(
	reason: DisconnectReason = 'timeout',
	options: { message?: string; suppressMessage?: boolean } = {}
): Promise<void> {
	const state = get(webrtcState);
	if (state.isDisconnecting) {
		return;
	}

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

	if (reason === 'error' && options.message) {
		errorMessage = options.message;
	} else if (reason !== 'error') {
		errorMessage = '';
	}

	resetMosData({ clearHistory: false });

	webrtcState.update((current) => ({
		...current,
		connection: null,
		connectionId: null,
		connectionState: 'disconnected',
		iceConnectionState: 'new',
		dataChannelState: 'closed',
		collectionStatusMessage,
		collectionEndAt: options.suppressMessage ? current.collectionEndAt : Date.now(),
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
