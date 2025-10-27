<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import {
		initializeLatencyMonitor,
		createEmptyLatencyStats,
		type LatencyStats
	} from '$lib/latency-probe';
	import { createServerConnection, type ServerConnection } from '$lib/rtc-client';
	import { startStatsReporter, type StatsSummary } from '$lib/rtc-stats';
	import LatencyMonitorPanel from '$lib/components/LatencyMonitorPanel.svelte';
	import NetworkHistoryChart from '$lib/components/NetworkHistoryChart.svelte';
	import { updateMosLatencyStats, resetMosData, ingestLatencySamples } from '$lib/stores/mosStore';

	export let data: PageData;
	const pageStore = page;

	const buildVersion = data.version;
	const buildCommit = data.gitCommit;
	const buildInfoLabel =
		buildCommit && buildCommit.length > 0
			? `Version ${buildVersion} - #${buildCommit}`
			: `Version ${buildVersion}`;

	const COLLECTION_DURATION_MS = 2 * 60 * 60 * 1000;

	let connection: ServerConnection | null = null;
	let connectionId: string | null = null;
	let connectionState: RTCPeerConnectionState = 'disconnected';
	let iceConnectionState: RTCIceConnectionState = 'new';
	let dataChannelState: RTCDataChannelState = 'closed';
	let statsSummary: StatsSummary | null = null;
	let isConnecting = false;
	let errorMessage = '';
	let outgoingMessage = 'probe';
	let messageId = 0;
	let isChartTestMode = false;

	let messages: Array<{
		id: number;
		direction: 'in' | 'out';
		payload: string;
		at: string;
		connectionId?: string | null;
	}> = [];

	let stopStats: (() => void) | null = null;
	let latencyStats: LatencyStats = createEmptyLatencyStats();
	const textDecoder = new TextDecoder();
	const textInputTags = new Set(['INPUT', 'TEXTAREA']);
	let collectionStatusMessage: string | null = null;
	let collectionStartAt: number | null = null;
	let activeDisconnectReason: 'manual' | 'timeout' | 'error' | 'auto' | null = null;
	let isDisconnecting = false;
	let collectionAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
	let elapsedMs: number | null = null;
	let bytesPerSecond: number | null = null;

	const SHOW_RECENT_PROBES_HISTORY = false;

	const latencyProbe = initializeLatencyMonitor({
		collectSamples: false,
		onStats: (stats) => {
			const snapshot = { ...stats, history: [] };
			latencyStats = snapshot;
			updateMosLatencyStats(snapshot);
		},
		onSamples: (samples) => {
			ingestLatencySamples(samples);
		}
	});

	const DATA_UNITS = ['bytes', 'Kbytes', 'Mbytes', 'Gbytes', 'Tbytes'];

	function formatDataAmount(
		value: number | null | undefined,
		options: { suffix?: string } = {}
	): string {
		if (value === null || value === undefined || !Number.isFinite(value)) {
			return '—';
		}

		let adjusted = value;
		let unitIndex = 0;
		while (Math.abs(adjusted) >= 1024 && unitIndex < DATA_UNITS.length - 1) {
			adjusted /= 1024;
			unitIndex += 1;
		}

		const magnitude = Math.abs(adjusted);
		const fractionDigits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
		const formatted = adjusted.toLocaleString(undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: fractionDigits
		});

		const suffix = options.suffix ?? '';
		return `${formatted} ${DATA_UNITS[unitIndex]}${suffix ? `/${suffix}` : ''}`;
	}

	function formatBytesPerSecond(value: number | null | undefined): string {
		if (value === null || value === undefined || !Number.isFinite(value)) {
			return '—';
		}
		return formatDataAmount(value, { suffix: 'sec' });
	}

	function formatElapsed(value: number | null): string {
		if (value === null || value < 0 || !Number.isFinite(value)) {
			return '—';
		}
		const totalSeconds = Math.floor(value / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const parts: string[] = [];
		if (hours > 0) {
			parts.push(`${hours}h`);
		}
		if (minutes > 0 || hours > 0) {
			parts.push(`${minutes}m`);
		}
		parts.push(`${seconds}s`);
		return parts.join(' ');
	}

	$: elapsedMs =
		statsSummary && collectionStartAt !== null
			? Math.max(0, statsSummary.timestamp - collectionStartAt)
			: null;

	$: bytesPerSecond =
		statsSummary && elapsedMs !== null && elapsedMs > 0
			? statsSummary.bytesSent / (elapsedMs / 1000)
			: null;

	$: isChartTestMode = $pageStore.url.searchParams.get('chartTest') === '1';
	function clearCollectionAutoStopTimer() {
		if (collectionAutoStopTimer) {
			clearTimeout(collectionAutoStopTimer);
			collectionAutoStopTimer = null;
		}
	}

	function scheduleCollectionAutoStop() {
		clearCollectionAutoStopTimer();
		collectionAutoStopTimer = setTimeout(() => {
			collectionAutoStopTimer = null;
			if (connection && !isDisconnecting) {
				void disconnect('auto');
			}
		}, COLLECTION_DURATION_MS);
	}

	function beginCollectionSession(dataChannel: RTCDataChannel) {
		collectionStartAt = Date.now();
		activeDisconnectReason = null;
		collectionStatusMessage = null;
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

	async function connectToServer() {
		if (isConnecting) return;

		isConnecting = true;
		errorMessage = '';
		collectionStatusMessage = null;
		collectionStartAt = null;
		statsSummary = null;
		activeDisconnectReason = null;
		clearCollectionAutoStopTimer();
		resetMosData();

		try {
			if (connection) {
				await disconnect('manual', { suppressMessage: true });
				activeDisconnectReason = null;
			}

			connection = await createServerConnection({
				onMessage: async (event: MessageEvent) => {
					const payload = await normaliseDataMessage(event.data);
					if (latencyProbe.handleMessage(payload)) {
						return;
					}

					messages = [
						...messages,
						{
							id: ++messageId,
							direction: 'in',
							payload,
							at: new Date().toLocaleTimeString(),
							connectionId
						}
					];
				},
				onOpen: () => {
					dataChannelState = connection?.dataChannel.readyState ?? 'open';
				},
				onError: (err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					errorMessage = message;
					latencyProbe.stop();
					if (
						activeDisconnectReason !== 'manual' &&
						activeDisconnectReason !== 'error' &&
						activeDisconnectReason !== 'auto'
					) {
						void disconnect('error', { message });
					}
				}
			});

			connectionId = connection.connectionId;

			const { peerConnection, dataChannel } = connection;

			connectionState = peerConnection.connectionState;
			iceConnectionState = peerConnection.iceConnectionState;
			dataChannelState = dataChannel.readyState;

			peerConnection.addEventListener('connectionstatechange', () => {
				connectionState = peerConnection.connectionState;
			});
			peerConnection.addEventListener('iceconnectionstatechange', () => {
				iceConnectionState = peerConnection.iceConnectionState;
			});

			dataChannel.addEventListener('open', () => {
				console.log(`dataChannel opened`);
				dataChannelState = dataChannel.readyState;
				beginCollectionSession(dataChannel);
			});

			dataChannel.addEventListener('close', () => {
				console.log(`dataChannel closed`);
				dataChannelState = dataChannel.readyState;
				latencyProbe.stop();
				if (
					activeDisconnectReason !== 'manual' &&
					activeDisconnectReason !== 'error' &&
					activeDisconnectReason !== 'auto'
				) {
					void disconnect('timeout');
				}
			});

			dataChannel.addEventListener('error', (e) => {
				console.log(`dataChannel error: ${e}`);
				latencyProbe.stop();
				const message = e instanceof Error ? e.message : String(e);
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
				statsSummary = summary;
			});
		} catch (err) {
			console.log(`dataChannel caught error: ${err}`);
			const message = err instanceof Error ? err.message : String(err);
			errorMessage = message;
			connectionState = 'failed';
			latencyProbe.stop();
			if (activeDisconnectReason !== 'manual' && activeDisconnectReason !== 'error') {
				await disconnect('error', { message });
			}
		} finally {
			isConnecting = false;
		}
	}

	async function disconnect(
		reason: 'manual' | 'timeout' | 'error' | 'auto' = 'timeout',
		options: { message?: string; suppressMessage?: boolean } = {}
	) {
		if (isDisconnecting) {
			return;
		}
		isDisconnecting = true;
		activeDisconnectReason = reason;

		latencyProbe.stop();
		stopStats?.();
		stopStats = null;
		clearCollectionAutoStopTimer();

		if (connection) {
			try {
				await connection.close();
			} catch (closeError) {
				console.error('Failed to close connection', closeError);
			}
			connection = null;
		}

		connectionId = null;
		connectionState = 'disconnected';
		iceConnectionState = 'new';
		dataChannelState = 'closed';

		if (!options.suppressMessage) {
			if (reason === 'manual') {
				collectionStatusMessage = 'Collection stopped manually';
			} else if (reason === 'timeout') {
				const referenceStart = collectionStartAt ?? Date.now();
				const elapsedMs = Date.now() - referenceStart;
				const minutes = Math.max(1, Math.ceil(elapsedMs / 60000));
				collectionStatusMessage = `Collection stopped after ${minutes} minute${minutes === 1 ? '' : 's'}`;
			} else if (reason === 'auto') {
				collectionStatusMessage = 'Collection stopped after two hours.';
			} else if (reason === 'error') {
				const detail = options.message?.trim();
				collectionStatusMessage = `Collection stopped: ${detail && detail.length > 0 ? detail : 'Unknown error'}`;
			}
		}

		if (reason === 'error' && options.message) {
			errorMessage = options.message;
		} else if (reason !== 'error') {
			errorMessage = '';
		}

		resetMosData({ clearHistory: false });
		isDisconnecting = false;
	}

	function sendMessage() {
		if (!connection || !outgoingMessage.trim()) {
			return;
		}

		connection.dataChannel.send(outgoingMessage);
		messages = [
			...messages,
			{
				id: ++messageId,
				direction: 'out',
				payload: outgoingMessage,
				at: new Date().toLocaleTimeString()
			}
		];
		outgoingMessage = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (
			event.key === 'Enter' &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey
		) {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName ?? '';
			if (target?.isContentEditable || textInputTags.has(tag)) {
				return;
			}

			if (!isConnecting && connectionState !== 'connected') {
				event.preventDefault();
				void connectToServer();
			}
			return;
		}

		if (
			(event.key === 'c' || event.key === 'C') &&
			event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey
		) {
			if (connection) {
				event.preventDefault();
				void disconnect('manual');
			}
		}
	}

	onMount(() => {
		if (!isConnecting && connectionState !== 'connected') {
			void connectToServer();
		}
	});

	onDestroy(() => {
		void disconnect('manual', { suppressMessage: true });
		resetMosData();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<main class="container">
	<section class="panel main-panel">
		<h1>Cutie &mdash; Network Quality Test</h1>
		<p>
			Open this page before beginning a call or videoconference and let it run in the background. It
			detects intervals of high packet loss, latency and jitter that impair the quality and
			stability of the network. The test runs for at most two hours, and consumes a bit of
			bandwidth, under two kilobytes per second.
		</p>

		<div class="controls">
			<button on:click={connectToServer} disabled={isConnecting || connectionState === 'connected'}>
				{#if isConnecting}
					Connecting…
				{:else if connectionState === 'connected'}
					Connected
				{:else}
					Start
				{/if}
			</button>
			<button on:click={() => disconnect('manual')} disabled={!connection}>Stop</button>
			<span class="build-info">
				{buildInfoLabel}
			</span>
		</div>

		{#if collectionStatusMessage}
			<div class="status">{collectionStatusMessage}</div>
		{:else if errorMessage}
			<div class="error">{errorMessage}</div>
		{/if}
	</section>

	<section class="panel charts-panel">
		<div class="charts-grid">
			<NetworkHistoryChart variant="mos" testMode={isChartTestMode} />
			<NetworkHistoryChart variant="packetLoss" />
			<NetworkHistoryChart variant="latencyJitter" />
		</div>
	</section>
	<LatencyMonitorPanel {latencyStats} showHistory={SHOW_RECENT_PROBES_HISTORY} />

	<section class="panel">
		<h2>Long-term Statistics</h2>
		{#if statsSummary}
			<table>
				<tbody>
					<tr>
						<th>Start Time</th>
						<td>{collectionStartAt ? new Date(collectionStartAt).toLocaleTimeString() : '—'}</td>
					</tr>
					<tr>
						<th>Elapsed Time</th>
						<td>{formatElapsed(elapsedMs)}</td>
					</tr>
					<tr>
						<th>Bytes Transferred</th>
						<td>{formatDataAmount(statsSummary.bytesSent)}</td>
					</tr>
					<tr>
						<th>Bytes/second</th>
						<td>{formatBytesPerSecond(bytesPerSecond)}</td>
					</tr>
				</tbody>
			</table>
		{:else}
			<p>No stats collected yet.</p>
		{/if}
	</section>

	<section class="panel status-grid">
		<div>
			<h2>Connection</h2>
			<p><strong>ID:</strong> {connectionId ?? '—'}</p>
			<p><strong>State:</strong> {connectionState}</p>
			<p><strong>ICE:</strong> {iceConnectionState}</p>
			<p><strong>Data channel:</strong> {dataChannelState}</p>
		</div>
		<div>
			<h2>Send Message</h2>
			<div class="message-form">
				<input
					placeholder="Type a message"
					bind:value={outgoingMessage}
					disabled={!connection || dataChannelState !== 'open'}
					on:keydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							sendMessage();
						}
					}}
				/>
				<button
					on:click={sendMessage}
					disabled={!connection || dataChannelState !== 'open' || !outgoingMessage.trim()}
				>
					Send
				</button>
			</div>
		</div>
	</section>

	<section class="panel">
		<h2>Message Log</h2>
		{#if messages.length === 0}
			<p>No messages exchanged yet.</p>
		{:else}
			<ul class="messages">
				{#each messages.slice(-10).reverse() as entry (entry.id)}
					<li class={entry.direction}>
						<span class="meta">{entry.at}</span>
						<span class="bubble">
							<strong>{entry.direction === 'in' ? 'Server' : 'Client'}:</strong>
							{entry.direction === 'in' && entry.connectionId
								? entry.payload.replace(/}$/, `, "connectionId": "${entry.connectionId}" }`)
								: entry.payload}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin: 0 auto;
		max-width: 960px;
		padding: 2rem 1rem 4rem;
	}

	:global(.panel) {
		background: #fafafa;
		border: 1px solid #e5e5e5;
		border-radius: 0.75rem;
		padding: 1.5rem;
		box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
	}

	.main-panel {
		position: relative;
	}

	.build-info {
		margin-left: auto;
		font-size: 0.8rem;
		color: #6b7280;
		align-self: flex-end;
	}

	h1,
	h2 {
		margin: 0 0 0.75rem;
		font-weight: 600;
	}

	.controls {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
		align-items: flex-end;
	}

	button {
		background: #2563eb;
		border: none;
		border-radius: 0.5rem;
		color: white;
		cursor: pointer;
		padding: 0.65rem 1.2rem;
		font-size: 1rem;
		font-weight: 500;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease,
			opacity 0.2s ease;
	}

	button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 12px 25px rgba(37, 99, 235, 0.2);
	}

	button:disabled {
		background: #a0aec0;
		cursor: not-allowed;
		opacity: 0.7;
	}

	.status,
	.error {
		margin-top: 1rem;
		border-radius: 0.5rem;
		padding: 0.75rem;
		font-size: 0.95rem;
	}

	.status {
		background: #dcfce7;
		color: #166534;
	}

	.error {
		background: #fee2e2;
		color: #991b1b;
	}

	.status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.5rem;
	}

	.message-form {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.message-form input {
		flex: 1;
		padding: 0.65rem 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid #d1d5db;
		font-size: 1rem;
	}

	.charts-panel {
		padding: 0.5rem 0.75rem;
	}

	.charts-grid {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.charts-grid :global(.chart-card) {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.1rem 0;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.messages {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.messages li {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
	}

	.messages li.out {
		align-items: flex-end;
	}

	.messages .meta {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.messages .bubble {
		max-width: 90%;
		background: #2563eb;
		color: white;
		border-radius: 0.75rem;
		padding: 0.75rem 0.85rem;
		box-shadow: 0 8px 18px rgba(37, 99, 235, 0.2);
		word-break: break-word;
	}

	.messages li.out .bubble {
		background: #10b981;
		box-shadow: 0 8px 18px rgba(16, 185, 129, 0.2);
	}

	@media (max-width: 800px) {
		.controls {
			flex-direction: column;
			align-items: stretch;
		}

		.message-form {
			flex-direction: column;
			align-items: stretch;
		}

		.message-form button {
			width: 100%;
		}
	}
</style>
