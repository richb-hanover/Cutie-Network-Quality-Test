<script lang="ts">
	import { type LatencyStats } from '$lib/latency-probe';
	import {
		calculateMosScore,
		tenSecondAverages,
		tenSecondMos
	} from '$lib/stores/mosStore';
	import type { RecentAverages } from '$lib/stores/mosStore';

	export let latencyStats: LatencyStats;

	const calculatePacketLossPercent = (lost: number, total: number): number | null => {
		if (total === 0) {
			return null;
		}
		return (lost / total) * 100;
	};

	const formatMs = (value: number | null): string => {
		if (value === null) return '—';
		return `${value.toFixed(2)} ms`;
	};

	const formatPercent = (value: number | null): string => {
		if (value === null) return '—';
		return `${value.toFixed(2)} %`;
	};

	const formatScore = (value: number | null): string => {
		if (value === null) return '—';
		return value.toFixed(2);
	};

	$: totalPacketLossPercent = calculatePacketLossPercent(
		latencyStats.totalLost,
		latencyStats.totalSent
	);

	$: mosInstant = calculateMosScore(
		latencyStats.lastLatencyMs,
		latencyStats.jitterMs,
		totalPacketLossPercent
	);

	let recent: RecentAverages = {
		packetLossPercent: null,
		averageLatencyMs: null,
		averageJitterMs: null
	};
	let mosAverage: number | null = null;

	$: recent = $tenSecondAverages;
	$: mosAverage = $tenSecondMos;
</script>

<section class="panel">
	<h2>Latency Monitor</h2>
	<table class="latency-summary">
		<thead>
			<tr>
				<th>Metric</th>
				<th>Instant</th>
				<th>10s Avg</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<th>Packet Loss %</th>
				<td>{formatPercent(totalPacketLossPercent)}</td>
				<td>{formatPercent(recent.packetLossPercent)}</td>
			</tr>
			<tr>
				<th>Last RTT</th>
				<td>{formatMs(latencyStats.lastLatencyMs)}</td>
				<td>{formatMs(recent.averageLatencyMs)}</td>
			</tr>
			<tr>
				<th>Jitter</th>
				<td>{formatMs(latencyStats.jitterMs)}</td>
				<td>{formatMs(recent.averageJitterMs)}</td>
			</tr>
			<tr>
				<th>MOS Quality</th>
				<td>{formatScore(mosInstant)}</td>
				<td>{formatScore(mosAverage)}</td>
			</tr>
		</tbody>
	</table>

	{#if latencyStats.history.length > 0}
		<h3>Recent Probes</h3>
		<table class="latency-history">
			<thead>
				<tr>
					<th>Seq</th>
					<th>Status</th>
					<th>Latency</th>
					<th>Jitter</th>
					<th>Time</th>
				</tr>
			</thead>
			<tbody>
				{#each latencyStats.history.slice().reverse() as sample (sample.seq + '-' + sample.at)}
					<tr class={sample.status}>
						<td>{sample.seq}</td>
						<td>{sample.status}</td>
						<td>{sample.latencyMs !== null ? `${sample.latencyMs.toFixed(2)} ms` : '—'}</td>
						<td>{sample.jitterMs !== null ? `${sample.jitterMs.toFixed(2)} ms` : '—'}</td>
						<td>{sample.at}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p>No latency samples yet.</p>
	{/if}
</section>

<style>
	.latency-summary,
	.latency-history {
		width: 100%;
		border-collapse: collapse;
	}

	.latency-summary thead th {
		font-weight: 600;
	}

	.latency-summary th,
	.latency-summary td,
	.latency-history th,
	.latency-history td {
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.latency-summary th:first-child {
		width: 40%;
	}

	.latency-summary {
		margin-bottom: 1rem;
	}

	.latency-history {
		margin-top: 0.75rem;
	}

	.latency-history tr.lost td {
		color: #b91c1c;
	}
</style>
