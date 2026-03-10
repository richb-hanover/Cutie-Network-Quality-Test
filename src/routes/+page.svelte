<script lang="ts">
	import { get } from 'svelte/store';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import {
		connectToServer,
		disconnect,
		sendMessage as sendWebrtcMessage,
		webrtcState,
		saveSession,
		loadSession
	} from '$lib/webrtc';
	import type { WebRtcState } from '$lib/webrtc';
	import { decompressCutieFile, formatLocalDateTime } from '$lib/session-file';
	import type { SessionBounds } from '$lib/session-file';
	import { marked } from 'marked';
	import LatencyMonitorPanel from '$lib/components/LatencyMonitorPanel.svelte';
	import NetworkHistoryChart from '$lib/components/NetworkHistoryChart.svelte';

	let showAbout = false;
	let aboutHtml = '';

	async function openAbout() {
		if (!aboutHtml) {
			const res = await fetch('/about.md');
			const md = await res.text();
			aboutHtml = await marked(md);
		}
		showAbout = true;
	}

	export let data: PageData;
	const buildVersion = data.version;
	const buildCommit = data.gitCommit;
	const buildInfoLabel =
		buildCommit && buildCommit.length > 0
			? `Version ${buildVersion} - #${buildCommit}`
			: `Version ${buildVersion}`;

	const DATA_UNITS = ['bytes', 'Kbytes', 'Mbytes', 'Gbytes', 'Tbytes'];
	const textInputTags = new Set(['INPUT', 'TEXTAREA']);
	const SHOW_RECENT_PROBES_HISTORY = false;

	let outgoingMessage = '';
	let panelBounds: SessionBounds | undefined;
	let isChartTestMode = false;
	let elapsedMs: number | null = null;
	let bytesPerSecond: number | null = null;

	let webrtcSnapshot: WebRtcState = get(webrtcState);
	let {
		connection,
		connectionState,
		dataChannelState,
		statsSummary,
		isConnecting,
		errorMessage,
		messages,
		latencyStats,
		collectionStatusMessage,
		collectionStartAt,
		collectionEndAt
	} = webrtcSnapshot;

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

	function formatDateTime(ts: number | null): string {
		if (ts === null) return '—';
		return formatLocalDateTime(ts);
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

	$: webrtcSnapshot = $webrtcState;
	$: ({
		connection,
		connectionState,
		dataChannelState,
		statsSummary,
		isConnecting,
		errorMessage,
		messages,
		latencyStats,
		collectionStatusMessage,
		collectionStartAt,
		collectionEndAt
	} = webrtcSnapshot);

	$: elapsedMs =
		statsSummary && collectionStartAt !== null
			? Math.max(0, statsSummary.timestamp - collectionStartAt)
			: null;

	$: bytesPerSecond =
		statsSummary && elapsedMs !== null && elapsedMs > 0
			? statsSummary.bytesSent / (elapsedMs / 1000)
			: null;

	// eslint-disable-next-line svelte/no-immutable-reactive-statements -- page from $app/state is reactive
	$: isChartTestMode = page.url.searchParams.get('chartTest') === '1';

	async function handleSave() {
		if (!panelBounds || collectionStartAt === null) return;
		await saveSession(panelBounds, buildVersion);
		if (connection) {
			await disconnect('manual');
		}
	}

	async function handleLoad(file: File) {
		const content = await decompressCutieFile(file);
		const data = await loadSession(content);
		if (data) {
			panelBounds = data.bounds;
		}
	}

	function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void handleLoad(file);
		input.value = '';
	}

	function handleSendMessage() {
		if (sendWebrtcMessage(outgoingMessage)) {
			outgoingMessage = '';
		}
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

		const handleCmdS = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName;
			if (textInputTags.has(tag)) return;
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault();
				if (collectionStartAt !== null) void handleSave();
			}
		};
		window.addEventListener('keydown', handleCmdS);
		return () => window.removeEventListener('keydown', handleCmdS);
	});

	onDestroy(() => {
		void disconnect('manual', { suppressMessage: true });
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<main
	class="container"
	on:dragover|preventDefault={(e) => {
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}}
	on:drop|preventDefault={(e) => {
		const file = e.dataTransfer?.files?.[0];
		if (file?.name.endsWith('.cutie')) void handleLoad(file);
	}}
>
	<section class="panel main-panel">
		<h1>Cutie &mdash; Network Quality Test</h1>
		<p>
			Open this page before beginning a call or videoconference and let it run in the background.
			Cutie detects impairments to the quality of your network and shows them in the charts.
		</p>

		<div class="controls">
			<div class="button-group">
				{#if connectionState === 'connected'}
					<button on:click={() => disconnect('manual')}>Stop</button>
				{:else}
					<button on:click={connectToServer} disabled={isConnecting}>
						{#if isConnecting}
							Connecting…
						{:else}
							Start
						{/if}
					</button>
				{/if}
				<button class="about-btn" on:click={openAbout}>About</button>
			</div>
			<span class="build-info">
				{buildInfoLabel}
			</span>
		</div>

		{#if errorMessage}
			<div class="error">{errorMessage}</div>
		{:else if collectionStatusMessage}
			<div class="status">{collectionStatusMessage}</div>
		{/if}
	</section>

	<section class="panel charts-panel">
		<div class="charts-grid">
			<NetworkHistoryChart variant="mos" testMode={isChartTestMode} />
			<NetworkHistoryChart variant="packetLoss" />
			<NetworkHistoryChart variant="latencyJitter" />
		</div>
	</section>
	<LatencyMonitorPanel
		{latencyStats}
		showHistory={SHOW_RECENT_PROBES_HISTORY}
		bind:bounds={panelBounds}
	/>

	<section class="panel">
		<h2>Long-term Statistics</h2>
		{#if statsSummary}
			<table>
				<tbody>
					<tr>
						<th>Start Time</th>
						<td>{formatDateTime(collectionStartAt)}</td>
					</tr>
					<tr>
						<th>End Time / Elapsed Time</th>
						<td
							>{collectionEndAt ? formatDateTime(collectionEndAt) : '-'} / {formatElapsed(
								elapsedMs
							)}</td
						>
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

	<section class="panel">
		<div class="message-log-header">
			<h2>Message Log</h2>
			<div class="message-form">
				<input
					placeholder="Type a message"
					bind:value={outgoingMessage}
					disabled={!connection || dataChannelState !== 'open'}
					on:keydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							handleSendMessage();
						}
					}}
				/>
				<button
					on:click={handleSendMessage}
					disabled={!connection || dataChannelState !== 'open' || !outgoingMessage.trim()}
				>
					Send
				</button>
			</div>
		</div>
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
							<!-- {entry.direction === 'in' && entry.connectionId
								? entry.payload.replace(/}$/, `, "connectionId": "${entry.connectionId}" }`)
								: entry.payload} -->
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel">
		<div class="save-reload-buttons">
			<button class="session-btn" on:click={handleSave} disabled={collectionStartAt === null}
				>Save Session</button
			>
			<label class="session-btn reload-button">
				Reload Session
				<input type="file" accept=".cutie" style="display:none" on:change={handleFileInput} />
			</label>
		</div>
	</section>
</main>

{#if showAbout}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="modal-overlay" on:click={() => (showAbout = false)}>
		<div class="modal-content" on:click|stopPropagation>
			<button class="modal-close" on:click={() => (showAbout = false)}>&times;</button>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- content is from our own static about.md -->
			{@html aboutHtml}
		</div>
	</div>
{/if}

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
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
		align-items: center;
	}

	.button-group {
		display: flex;
		gap: 0.75rem;
		flex-shrink: 0;
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

	.message-log-header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin-bottom: 0.75rem;
	}

	.message-log-header h2 {
		margin: 0;
		white-space: nowrap;
	}

	.message-form {
		display: flex;
		flex: 1;
		min-width: calc(15ch + 6rem); /* wrap before input shrinks below ~15 chars */
		gap: 0.75rem;
		align-items: center;
	}

	.message-form input {
		flex: 1;
		min-width: 0;
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

	.about-btn {
		background: #6b7280;
	}

	.about-btn:hover:not(:disabled) {
		background: #4b5563;
		box-shadow: 0 12px 25px rgba(107, 114, 128, 0.2);
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal-content {
		position: relative;
		background: white;
		border-radius: 0.75rem;
		padding: 2rem;
		max-width: 640px;
		width: 90%;
		max-height: 80vh;
		overflow-y: auto;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}

	.modal-content :global(h1:first-child) {
		margin-top: 0;
	}

	.modal-close {
		position: absolute;
		top: 0.5rem;
		right: 0.75rem;
		background: none;
		border: none;
		font-size: 1.5rem;
		color: #6b7280;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		box-shadow: none;
	}

	.modal-close:hover:not(:disabled) {
		color: #111;
		transform: none;
		box-shadow: none;
	}

	.save-reload-buttons {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
	}

	.session-btn {
		background: #fff;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		color: #374151;
		cursor: pointer;
		padding: 0.65rem 1.2rem;
		font-size: 1rem;
		font-weight: 500;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease,
			opacity 0.2s ease;
	}

	.session-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 12px 25px rgba(0, 0, 0, 0.1);
	}

	.session-btn:disabled {
		background: #f3f4f6;
		color: #9ca3af;
		cursor: not-allowed;
		opacity: 0.7;
	}

	.reload-button {
		display: inline-flex;
		align-items: center;
	}
</style>
