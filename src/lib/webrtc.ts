import { get, writable } from 'svelte/store';
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

export type LatencyProbeCsvRow = {
	seq: number;
	sentAt: number;
	receivedAt: number;
};

export type MessageEntry = {
	id: number;
	direction: 'in' | 'out';
	payload: string;
	at: string;
	connectionId?: string | null;
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
	activeDisconnectReason: DisconnectReason | null;
	isDisconnecting: boolean;
	recordedProbes: LatencyProbeCsvRow[];
	isCreateDataMode: boolean;
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
	activeDisconnectReason: null,
	isDisconnecting: false,
	recordedProbes: [],
	isCreateDataMode: false
};

const COLLECTION_DURATION_MS = 2 * 60 * 60 * 1000;
const LATENCY_CSV_HEADER = '# sequence,sentAt,receivedAt';

export const webrtcState = writable<WebRtcState>(initialState);

const textDecoder = new TextDecoder();
let stopStats: (() => void) | null = null;
let collectionAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
let messageId = 0;

const latencyProbe = initializeLatencyMonitor({
	collectSamples: false,
	onStats: (stats) => {
		const snapshot = { ...stats, history: [] };
		webrtcState.update((state) => ({ ...state, latencyStats: snapshot }));
		updateMosLatencyStats(snapshot);
	},
	onSamples: (samples) => {
		ingestLatencySamples(samples);
	},
	onProbeReceived: ({ seq, sentAt, receivedAt }) => {
		const state = get(webrtcState);
		if (!state.isCreateDataMode) {
			return;
		}
		webrtcState.update((current) => ({
			...current,
			recordedProbes: [...current.recordedProbes, { seq, sentAt, receivedAt }]
		}));
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
	const startAt = Date.now();
	webrtcState.update((state) => ({
		...state,
		collectionStartAt: startAt,
		activeDisconnectReason: null,
		collectionStatusMessage: null,
		recordedProbes: state.isCreateDataMode ? [] : state.recordedProbes
	}));
	scheduleCollectionAutoStop();
	latencyProbe.start(dataChannel);
}

export function setCreateDataMode(enabled: boolean): void {
	webrtcState.update((state) => {
		if (state.isCreateDataMode === enabled) {
			return state;
		}
		return {
			...state,
			isCreateDataMode: enabled,
			recordedProbes: enabled ? state.recordedProbes : []
		};
	});
}

function formatProbeNumber(value: number): string {
	return Number.isFinite(value) ? value.toFixed(3) : '';
}

function formatFileTimestamp(date: Date): string {
	const pad = (input: number) => input.toString().padStart(2, '0');
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	return `${year}-${month}-${day}-${hours}:${minutes}`;
}

function downloadLatencyProbeCsv(rows: LatencyProbeCsvRow[]): string | null {
	if (!rows.length) {
		return null;
	}
	const lines = rows.map(
		(row) => `${row.seq},${formatProbeNumber(row.sentAt)},${formatProbeNumber(row.receivedAt)}`
	);
	const csv = [LATENCY_CSV_HEADER, ...lines, ''].join('\n');
	const timestamp = formatFileTimestamp(new Date());
	const fileName = `cutie-results-${timestamp}.csv`;
	const blob = new Blob([csv], { type: 'text/csv' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
	return fileName;
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

	webrtcState.update((current) => ({
		...current,
		isConnecting: true,
		errorMessage: '',
		collectionStatusMessage: null,
		collectionStartAt: null,
		statsSummary: null,
		activeDisconnectReason: null
	}));

	clearCollectionAutoStopTimer();
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

	webrtcState.update((current) => ({
		...current,
		isDisconnecting: true,
		activeDisconnectReason: reason
	}));

	let savedCsv: string | null = null;

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

	if (state.isCreateDataMode && state.recordedProbes.length > 0) {
		savedCsv = downloadLatencyProbeCsv(state.recordedProbes);
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
		errorMessage,
		recordedProbes: state.isCreateDataMode ? [] : current.recordedProbes,
		isDisconnecting: false
	}));

	if (savedCsv && !options.suppressMessage) {
		webrtcState.update((current) => {
			const prefix = current.collectionStatusMessage ? `${current.collectionStatusMessage} ` : '';
			return { ...current, collectionStatusMessage: `${prefix}Saved latency probe data to ${savedCsv}` };
		});
	}
}

export function sendMessage(outgoingMessage: string): boolean {
	const trimmed = outgoingMessage.trim();
	const state = get(webrtcState);
	if (!state.connection || !trimmed) {
		return false;
	}

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
