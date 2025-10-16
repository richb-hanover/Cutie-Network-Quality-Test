<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		createLatencyMonitor,
		createEmptyLatencyStats,
		type LatencyStats
	} from '$lib/latency-probe';
	import { createServerConnection, type ServerConnection } from '$lib/rtc-client';
	import { startStatsReporter, type StatsSummary } from '$lib/rtc-stats';
	import LatencyMonitorPanel from '$lib/components/LatencyMonitorPanel.svelte';

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

	let messages: Array<{ id: number; direction: 'in' | 'out'; payload: string; at: string }> = [];

	let stopStats: (() => void) | null = null;
	let latencyStats: LatencyStats = createEmptyLatencyStats();
	const textDecoder = new TextDecoder();
	const textInputTags = new Set(['INPUT', 'TEXTAREA']);
	let disconnectNotice: 'timeout' | null = null;

	const latencyProbe = createLatencyMonitor({
		onStats: (stats) => {
			latencyStats = { ...stats, history: [...stats.history] };
		}
	});

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
		disconnectNotice = null;

		try {
			if (connection) {
				await disconnect('manual');
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
							at: new Date().toLocaleTimeString()
						}
					];
				},
				onOpen: () => {
					dataChannelState = connection?.dataChannel.readyState ?? 'open';
				},
				onError: (err: unknown) => {
					errorMessage = err instanceof Error ? err.message : String(err);
					latencyProbe.stop();
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
				latencyProbe.start(dataChannel);
			});

			dataChannel.addEventListener('close', () => {
				console.log(`dataChannel closed`);
				dataChannelState = dataChannel.readyState;
				latencyProbe.stop();
				void disconnect('timeout');
			});

			dataChannel.addEventListener('error', (e) => {
				console.log(`dataChannel error: ${e}`);
				latencyProbe.stop();
			});

			if (dataChannel.readyState === 'open') {
				latencyProbe.start(dataChannel);
			}

			stopStats?.();
			stopStats = startStatsReporter(peerConnection, (summary: StatsSummary) => {
				statsSummary = summary;
			});
		} catch (err) {
			console.log(`dataChannel caught error: ${err}`);
			errorMessage = err instanceof Error ? err.message : String(err);
			connectionState = 'failed';
			latencyProbe.stop();
		} finally {
			isConnecting = false;
		}
	}

	async function disconnect(reason: 'manual' | 'timeout' = 'timeout') {
		latencyProbe.stop();
		stopStats?.();
		stopStats = null;

		if (connection) {
			await connection.close();
			connection = null;
		}

		connectionId = null;
		connectionState = 'disconnected';
		iceConnectionState = 'new';
		dataChannelState = 'closed';

		if (reason === 'timeout') {
			disconnectNotice = 'timeout';
		}
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

	onDestroy(() => {
		disconnect();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<main class="container">
	<section class="panel">
		<h1>WebRTC Network Stability Test</h1>
		<p>
			Establish a data-channel connection to the server, exchange messages, and monitor live WebRTC
			statistics.
		</p>

		<div class="controls">
			<button on:click={connectToServer} disabled={isConnecting || connectionState === 'connected'}>
				{#if isConnecting}
					Connecting…
				{:else if connectionState === 'connected'}
					Connected
				{:else}
					Connect
				{/if}
			</button>
			<button on:click={() => disconnect('manual')} disabled={!connection}>Disconnect</button>
		</div>

		<!-- {#if disconnectNotice}
			<div class="error">Data channel closed</div>
		{/if} -->

		{#if errorMessage}
			<div class="error">{errorMessage}</div>
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
		<h2>Statistics</h2>
		{#if statsSummary}
			<table>
				<tbody>
					<tr>
						<th>Timestamp</th>
						<td>{new Date(statsSummary.timestamp).toLocaleTimeString()}</td>
					</tr>
					<tr>
						<th>Bytes Sent</th>
						<td>{statsSummary.bytesSent}</td>
					</tr>
					<tr>
						<th>Bytes Received</th>
						<td>{statsSummary.bytesReceived}</td>
					</tr>
					<tr>
						<th>Packets Sent</th>
						<td>{statsSummary.packetsSent}</td>
					</tr>
					<tr>
						<th>Packets Received</th>
						<td>{statsSummary.packetsReceived}</td>
					</tr>
					<tr>
						<th>Messages Sent</th>
						<td>{statsSummary.messagesSent}</td>
					</tr>
					<tr>
						<th>Messages Received</th>
						<td>{statsSummary.messagesReceived}</td>
					</tr>
					<tr>
						<th>Round Trip Time</th>
						<td>{statsSummary.currentRoundTripTime ?? '—'}</td>
					</tr>
				</tbody>
			</table>
		{:else}
			<p>No stats collected yet.</p>
		{/if}
	</section>

	<LatencyMonitorPanel {latencyStats} />

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
							{entry.payload}
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

	h1,
	h2 {
		margin: 0 0 0.75rem;
		font-weight: 600;
	}

	.controls {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
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

	.error {
		margin-top: 1rem;
		border-radius: 0.5rem;
		background: #fee2e2;
		color: #991b1b;
		padding: 0.75rem;
		font-size: 0.95rem;
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

	@media (max-width: 640px) {
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
