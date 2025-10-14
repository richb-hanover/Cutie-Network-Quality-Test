
<script lang="ts">
	import { onDestroy } from 'svelte';

	type StatsSummary = {
		timestamp: number;
		bytesSent: number;
		bytesReceived: number;
		packetsSent: number;
		packetsReceived: number;
		messagesSent: number;
		messagesReceived: number;
		currentRoundTripTime: number | null;
	};

	type ConnectionResult = {
		peerConnection: RTCPeerConnection;
		dataChannel: RTCDataChannel;
		connectionId: string;
		close: () => Promise<void>;
	};

	type ClientModule = {
		createServerConnection: (options?: {
			rtcConfig?: RTCConfiguration;
			signalUrl?: string;
			onMessage?: (event: MessageEvent) => void;
			onOpen?: () => void;
			onError?: (error: unknown) => void;
		}) => Promise<ConnectionResult>;
	};

	type StatsModule = {
		startStatsReporter: (
			peer: RTCPeerConnection,
			callback: (summary: StatsSummary, report: RTCStatsReport) => void,
			intervalMs?: number
		) => () => void;
	};

	type HelperModules = {
		client: ClientModule;
		stats: StatsModule;
	};

	let helpersPromise: Promise<HelperModules> | null = null;
	let connection: ConnectionResult | null = null;
	let connectionId: string | null = null;
	let connectionState: RTCPeerConnectionState = 'disconnected';
	let iceConnectionState: RTCIceConnectionState = 'new';
	let dataChannelState: RTCDataChannelState = 'closed';
	let statsSummary: StatsSummary | null = null;
	let isConnecting = false;
	let errorMessage = '';
	let outgoingMessage = 'ping';
	let messageId = 0;

	let messages: Array<{ id: number; direction: 'in' | 'out'; payload: string; at: string }> = [];

	let stopStats: (() => void) | null = null;

	function loadScript(src: string): Promise<void> {
		if (typeof document === 'undefined') {
			return Promise.reject(new Error('Cannot load helper scripts on the server.'));
		}

		const existing = document.querySelector<HTMLScriptElement>(`script[data-rtc-src="${src}"]`);
		if (existing) {
			if (existing.dataset.ready === 'true') {
				return Promise.resolve();
			}

			return new Promise((resolve, reject) => {
				existing.addEventListener('load', () => resolve(), { once: true });
				existing.addEventListener(
					'error',
					() => reject(new Error(`Failed to load helper script ${src}`)),
					{ once: true }
				);
			});
		}

		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.type = 'module';
			script.src = src;
			script.dataset.rtcSrc = src;
			script.addEventListener(
				'load',
				() => {
					script.dataset.ready = 'true';
					resolve();
				},
				{ once: true }
			);
			script.addEventListener(
				'error',
				() => reject(new Error(`Failed to load helper script ${src}`)),
				{ once: true }
			);
			document.head.appendChild(script);
		});
	}

	function ensureHelpers(): Promise<HelperModules> {
		if (typeof window === 'undefined') {
			return Promise.reject(new Error('RTC helpers are only available in the browser.'));
		}

		if (!helpersPromise) {
			helpersPromise = Promise.all([loadScript('/js/rtc-client.js'), loadScript('/js/rtc-stats.js')]).then(
				() => {
					if (!window.RtcClient || !window.RtcStats) {
						throw new Error('RTC helper scripts failed to initialise.');
					}

					return {
						client: window.RtcClient!,
						stats: window.RtcStats!
					};
				}
			);
		}

		return helpersPromise;
	}

	async function connectToServer() {
		if (isConnecting) return;

		isConnecting = true;
		errorMessage = '';

		try {
			if (connection) {
				await disconnect();
			}

			const { client, stats } = await ensureHelpers();

			connection = await client.createServerConnection({
				onMessage: (event: MessageEvent) => {
					messages = [
						...messages,
						{
							id: ++messageId,
							direction: 'in',
							payload: String(event.data),
							at: new Date().toLocaleTimeString()
						}
					];
				},
				onOpen: () => {
					dataChannelState = connection?.dataChannel.readyState ?? 'open';
				},
				onError: (err: unknown) => {
					errorMessage = err instanceof Error ? err.message : String(err);
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
				dataChannelState = dataChannel.readyState;
			});

			dataChannel.addEventListener('close', () => {
				dataChannelState = dataChannel.readyState;
			});

			stopStats?.();
			stopStats = stats.startStatsReporter(peerConnection, (summary: StatsSummary) => {
				statsSummary = summary;
			});
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
			connectionState = 'failed';
		} finally {
			isConnecting = false;
		}
	}

	async function disconnect() {
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

	onDestroy(() => {
		disconnect();
	});
</script>

<svelte:head>
	<link rel="modulepreload" href="/js/rtc-client.js" />
	<link rel="modulepreload" href="/js/rtc-stats.js" />
</svelte:head>

<main class="container">
	<section class="panel">
		<h1>WebRTC Control Panel</h1>
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
			<button on:click={disconnect} disabled={!connection}>Disconnect</button>
		</div>

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
							<strong>{entry.direction === 'in' ? 'Server' : 'Client'}:</strong> {entry.payload}
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

	.panel {
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
		transition: transform 0.1s ease, box-shadow 0.1s ease, opacity 0.2s ease;
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
