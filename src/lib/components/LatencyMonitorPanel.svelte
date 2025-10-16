<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { type LatencySample, type LatencyStats } from '$lib/latency-probe';

	const TEN_SECONDS_MS = 10000;
	const REFRESH_INTERVAL_MS = TEN_SECONDS_MS;

	export let latencyStats: LatencyStats;
	const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

	type RecentAverages = {
		packetLossPercent: number | null;
		averageLatencyMs: number | null;
		averageJitterMs: number | null;
	};

	const calculatePacketLossPercent = (lost: number, total: number): number | null => {
		if (total === 0) {
			return null;
		}
		return (lost / total) * 100;
	};

	const computeRecentAverages = (history: LatencySample[]): RecentAverages => {
		if (!history.length) {
			return {
				packetLossPercent: null,
				averageLatencyMs: null,
				averageJitterMs: null
			};
		}

		const cutoff = getNow() - TEN_SECONDS_MS;

		let lost = 0;
		let total = 0;
		let latencySum = 0;
		let latencyCount = 0;
		let jitterSum = 0;
		let jitterCount = 0;

		for (const sample of history) {
			if (sample.timestampMs < cutoff) {
				continue;
			}

			if (sample.status === 'lost' || sample.status === 'received') {
				total += 1;
				if (sample.status === 'lost') {
					lost += 1;
				}
			}

			if (sample.latencyMs !== null) {
				latencySum += sample.latencyMs;
				latencyCount += 1;
			}

			if (sample.jitterMs !== null) {
				jitterSum += sample.jitterMs;
				jitterCount += 1;
			}
		}

		return {
			packetLossPercent: calculatePacketLossPercent(lost, total),
			averageLatencyMs: latencyCount ? latencySum / latencyCount : null,
			averageJitterMs: jitterCount ? jitterSum / jitterCount : null
		};
	};

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	/**
	 * calculateMOS() - uses the "netbeez" formula expressed at:
	 * https://netbeez.net/blog/impact-of-packet-loss-jitter-and-latency-on-voip/
	 * See also the Theory of Operation which links to the original paper
	 * @param latencyMs
	 * @param jitterMs
	 * @param packetLossPercent
	 */
	const calculateMOS = (
		latencyMs: number | null,
		jitterMs: number | null,
		packetLossPercent: number | null
	): number | null => {
		let rFactor = 93.2;
		try {
			if (latencyMs === null || jitterMs === null || packetLossPercent === null) {
				// return null;
				const err = `latency: ${latencyMs} jitter: ${jitterMs} packetloss: ${packetLossPercent}`;
				throw `Missing values for MOS: ${err}`;
			}
			// compute effective latency
			const effectiveLatency = latencyMs + jitterMs * 2 + 10;
			// factor in effective latency
			if (effectiveLatency < 160.0) {
				rFactor -= effectiveLatency / 40.0;
			} else {
				rFactor -= (effectiveLatency - 120.0) / 10.0;
			}
			// factor in packet loss
			rFactor -= 2.5 * packetLossPercent;
		} catch {}

		// finally, compute and return MOS
		if (rFactor < 0) return 1.0;
		if (rFactor > 100.0) return 4.5;
		const mos = 1 + 0.035 * rFactor + 7.0e-6 * rFactor * (rFactor - 60) * (100 - rFactor);
		return Math.round(mos * 100) / 100;
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

	let recentAverages: RecentAverages = {
		packetLossPercent: null,
		averageLatencyMs: null,
		averageJitterMs: null
	};

	let averagesTimer: ReturnType<typeof setInterval> | null = null;

	const updateRecentAverages = () => {
		recentAverages = computeRecentAverages(latencyStats.history);
	};

	onMount(() => {
		updateRecentAverages();
		averagesTimer = setInterval(updateRecentAverages, REFRESH_INTERVAL_MS);
	});

	onDestroy(() => {
		if (averagesTimer) {
			clearInterval(averagesTimer);
			averagesTimer = null;
		}
	});

	$: totalPacketLossPercent = calculatePacketLossPercent(
		latencyStats.totalLost,
		latencyStats.totalSent
	);

	$: mosInstant = calculateMOS(
		latencyStats.lastLatencyMs,
		latencyStats.jitterMs,
		totalPacketLossPercent
	);
	$: mosAverage = calculateMOS(
		recentAverages.averageLatencyMs,
		recentAverages.averageJitterMs,
		recentAverages.packetLossPercent
	);
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
				<td>{formatPercent(recentAverages.packetLossPercent)}</td>
			</tr>
			<tr>
				<th>Last RTT</th>
				<td>{formatMs(latencyStats.lastLatencyMs)}</td>
				<td>{formatMs(recentAverages.averageLatencyMs)}</td>
			</tr>
			<tr>
				<th>Jitter</th>
				<td>{formatMs(latencyStats.jitterMs)}</td>
				<td>{formatMs(recentAverages.averageJitterMs)}</td>
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
