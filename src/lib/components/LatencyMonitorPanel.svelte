<script lang="ts">
	import { type LatencyStats } from '$lib/latency-probe';
	import { calculateMosScore, tenSecondAverages, tenSecondMos } from '$lib/stores/mosStore';
	import type { RecentAverages } from '$lib/stores/mosStore';

	export let latencyStats: LatencyStats;
	export let showHistory = true;

	type MetricKey = 'packetLossPercent' | 'latencyMs' | 'jitterMs' | 'mos';

	type MetricBounds = {
		[key in MetricKey]: { min: number | null; max: number | null };
	};

	const createMetricBounds = (): MetricBounds => ({
		packetLossPercent: { min: null, max: null },
		latencyMs: { min: null, max: null },
		jitterMs: { min: null, max: null },
		mos: { min: null, max: null }
	});

	let bounds = createMetricBounds();

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

	const updateBounds = (key: MetricKey, value: number | null) => {
		if (value === null || Number.isNaN(value)) {
			return;
		}

		const current = bounds[key];
		const nextMin = current.min === null ? value : Math.min(current.min, value);
		const nextMax = current.max === null ? value : Math.max(current.max, value);

		if (nextMin !== current.min || nextMax !== current.max) {
			bounds = {
				...bounds,
				[key]: {
					min: nextMin,
					max: nextMax
				}
			};
		}
	};

	const resetBoundsIfCleared = (stats: LatencyStats) => {
		if (stats.totalSent === 0 && stats.totalReceived === 0 && stats.totalLost === 0) {
			bounds = createMetricBounds();
		}
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
	$: resetBoundsIfCleared(latencyStats);
	$: updateBounds('packetLossPercent', totalPacketLossPercent);
	$: updateBounds('latencyMs', latencyStats.lastLatencyMs);
	$: updateBounds('jitterMs', latencyStats.jitterMs);
	$: updateBounds('mos', mosInstant);

	const toNumber = (value: number | null): number =>
		value === null || Number.isNaN(value) ? Number.NaN : value;

	const toNumberArray = (values: Array<number | null>): number[] =>
		values.map((value) => toNumber(value));

	export const getLatencyMonitorStats = () => ({
		MOSQuality: toNumberArray([mosInstant, bounds.mos.min, bounds.mos.max, mosAverage]),
		PacketLoss: toNumberArray([
			totalPacketLossPercent,
			bounds.packetLossPercent.min,
			bounds.packetLossPercent.max,
			recent.packetLossPercent
		]),
		Latency: toNumberArray([
			latencyStats.lastLatencyMs,
			bounds.latencyMs.min,
			bounds.latencyMs.max,
			recent.averageLatencyMs
		]),
		Jitter: toNumberArray([
			latencyStats.jitterMs,
			bounds.jitterMs.min,
			bounds.jitterMs.max,
			recent.averageJitterMs
		])
	});
</script>

<section class="panel">
	<h2>Latency Monitor</h2>
	<table class="latency-summary">
		<thead>
			<tr>
				<th>Metric</th>
				<th>Now</th>
				<th>Min</th>
				<th>Max</th>
				<th>10s Avg</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<th>MOS Quality</th>
				<td>{formatScore(mosInstant)}</td>
				<td>{formatScore(bounds.mos.min)}</td>
				<td>{formatScore(bounds.mos.max)}</td>
				<td>{formatScore(mosAverage)}</td>
			</tr>

			<tr>
				<th>Packet Loss %</th>
				<td>{formatPercent(totalPacketLossPercent)}</td>
				<td>{formatPercent(bounds.packetLossPercent.min)}</td>
				<td>{formatPercent(bounds.packetLossPercent.max)}</td>
				<td>{formatPercent(recent.packetLossPercent)}</td>
			</tr>
			<tr>
				<th>Latency</th>
				<td>{formatMs(latencyStats.lastLatencyMs)}</td>
				<td>{formatMs(bounds.latencyMs.min)}</td>
				<td>{formatMs(bounds.latencyMs.max)}</td>
				<td>{formatMs(recent.averageLatencyMs)}</td>
			</tr>
			<tr>
				<th>Jitter</th>
				<td>{formatMs(latencyStats.jitterMs)}</td>
				<td>{formatMs(bounds.jitterMs.min)}</td>
				<td>{formatMs(bounds.jitterMs.max)}</td>
				<td>{formatMs(recent.averageJitterMs)}</td>
			</tr>
		</tbody>
	</table>

	{#if showHistory}
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
