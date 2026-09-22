import { derived, writable } from 'svelte/store';
import type { LatencySample, LatencyStats } from '$lib/latency-probe';
import type { RawProbe } from '$lib/session-file';

const TEN_SECONDS_MS = 10_000;
const MAX_HISTORY_SAMPLES = 1000;

export type RecentAverages = {
	packetLossPercent: number | null;
	averageLatencyMs: number | null;
	averageJitterMs: number | null;
};

export type MosPoint = {
	at: number;
	value: number;
};

export type TenSecondSummary = {
	at: number;
	mos: number | null;
	packetLossPercent: number | null;
	averageLatencyMs: number | null;
	averageJitterMs: number | null;
};

const createEmptyAverages = (): RecentAverages => ({
	packetLossPercent: null,
	averageLatencyMs: null,
	averageJitterMs: null
});

const recentAveragesStore = writable<RecentAverages>(createEmptyAverages());
const mosAverageStore = writable<number | null>(null);
const summaryHistoryStore = writable<TenSecondSummary[]>([]);

const createValueHistoryStore = (selector: (summary: TenSecondSummary) => number | null) =>
	derived(summaryHistoryStore, ($history) =>
		$history.reduce<MosPoint[]>((acc, summary) => {
			const value = selector(summary);
			if (value === null || Number.isNaN(value)) {
				return acc;
			}
			acc.push({ at: summary.at, value });
			return acc;
		}, [])
	);

let latestStats: LatencyStats | null = null;
let sampleHistory: LatencySample[] = [];
let interval: ReturnType<typeof setInterval> | null = null;

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const calculatePacketLossPercent = (lost: number, total: number): number | null => {
	if (total === 0) {
		return null;
	}
	return (lost / total) * 100;
};

/** Average a batch of samples as-is, with no time-window filtering of its own. */
const computeAverages = (history: LatencySample[]): RecentAverages => {
	let lost = 0;
	let total = 0;
	let latencySum = 0;
	let latencyCount = 0;
	let jitterSum = 0;
	let jitterCount = 0;

	for (const sample of history) {
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

const computeRecentAverages = (history: LatencySample[]): RecentAverages => {
	const cutoff = performanceNow() - TEN_SECONDS_MS;
	return computeAverages(history.filter((sample) => sample.timestampMs >= cutoff));
};

export const calculateMosScore = (
	latencyMs: number | null,
	jitterMs: number | null,
	packetLossPercent: number | null
): number | null => {
	let rFactor = 93.2;
	try {
		if (latencyMs === null || jitterMs === null || packetLossPercent === null) {
			const err = `latency: ${latencyMs} jitter: ${jitterMs} packetloss: ${packetLossPercent}`;
			throw `Missing values for MOS: ${err}`;
		}
		const effectiveLatency = latencyMs + jitterMs * 2 + 10;
		if (effectiveLatency < 160.0) {
			rFactor -= effectiveLatency / 40.0;
		} else {
			rFactor -= (effectiveLatency - 120.0) / 10.0;
		}
		rFactor -= 2.5 * packetLossPercent;
	} catch {
		return null;
	}

	if (rFactor < 0) return 1.0;
	if (rFactor > 100.0) return 4.5;
	const mos = 1 + 0.035 * rFactor + 7.0e-6 * rFactor * (rFactor - 60) * (100 - rFactor);
	return Math.round(mos * 100) / 100;
};

const tick = () => {
	if (!latestStats) {
		return;
	}

	const cutoff = performanceNow() - TEN_SECONDS_MS;
	sampleHistory = sampleHistory.filter((sample) => sample.timestampMs >= cutoff);

	const averages = computeRecentAverages(sampleHistory);
	recentAveragesStore.set(averages);

	const mosValue = calculateMosScore(
		averages.averageLatencyMs,
		averages.averageJitterMs,
		averages.packetLossPercent
	);

	mosAverageStore.set(mosValue);

	const hasData =
		mosValue !== null ||
		averages.packetLossPercent !== null ||
		averages.averageLatencyMs !== null ||
		averages.averageJitterMs !== null;

	if (!hasData) {
		return;
	}

	const at = Date.now();

	const summary: TenSecondSummary = {
		at,
		mos: mosValue,
		packetLossPercent: averages.packetLossPercent,
		averageLatencyMs: averages.averageLatencyMs,
		averageJitterMs: averages.averageJitterMs
	};

	summaryHistoryStore.update((history) => {
		const next = [...history, summary];
		return next.slice(-MAX_HISTORY_SAMPLES);
	});
};

const ensureInterval = () => {
	if (!interval) {
		interval = setInterval(tick, TEN_SECONDS_MS);
	}
};

export const tenSecondAverages = {
	subscribe: recentAveragesStore.subscribe
};

export const tenSecondMos = {
	subscribe: mosAverageStore.subscribe
};

export const tenSecondSummaryHistory = {
	subscribe: summaryHistoryStore.subscribe
};

export const tenSecondMosHistory = createValueHistoryStore((summary) => summary.mos);

export const tenSecondPacketLossHistory = createValueHistoryStore(
	(summary) => summary.packetLossPercent
);

export const tenSecondLatencyHistory = createValueHistoryStore(
	(summary) => summary.averageLatencyMs
);

export const tenSecondJitterHistory = createValueHistoryStore((summary) => summary.averageJitterMs);

export const ingestLatencySamples = (samples: LatencySample[]) => {
	if (!samples.length) {
		return;
	}
	sampleHistory = [...sampleHistory, ...samples];
	if (sampleHistory.length > MAX_HISTORY_SAMPLES) {
		sampleHistory = sampleHistory.slice(-MAX_HISTORY_SAMPLES);
	}
};

export const updateMosLatencyStats = (stats: LatencyStats) => {
	latestStats = stats;
	ensureInterval();
};

export const resetMosData = (options?: { clearHistory?: boolean }) => {
	latestStats = null;
	sampleHistory = [];
	if (options?.clearHistory !== false) {
		recentAveragesStore.set(createEmptyAverages());
		mosAverageStore.set(null);
		summaryHistoryStore.set([]);
	}
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
};

export const loadRecentAverages = (averages: RecentAverages, mos: number | null): void => {
	recentAveragesStore.set(averages);
	mosAverageStore.set(mos);
};

/**
 * trimSessionDataAfter() - discard everything from the cutoff onward: chart summaries
 * and the raw samples backing the "recent" 10-second averages. Used when collection
 * stops because Cutie was in the background, so the live tiles and the chart history
 * agree with the trimmed probes saved to the .cutie file, rather than freezing on a
 * stale or hidden-period-biased reading.
 *
 * Two cutoffs are needed because the two stores use different clocks: chart summaries
 * are stamped with `Date.now()` (wall-clock epoch ms), while latency samples are
 * stamped with the same clock latency-probe uses internally (`performance.now()` when
 * available). Pass the same clock each cutoff is compared against.
 * @param cutoffAtMs - wall-clock epoch ms; chart summaries at or after this are dropped
 * @param cutoffSampleMs - the sample clock's ms; samples at or after this are dropped
 */
export const trimSessionDataAfter = (cutoffAtMs: number, cutoffSampleMs: number): void => {
	summaryHistoryStore.update((history) => history.filter((summary) => summary.at < cutoffAtMs));

	sampleHistory = sampleHistory.filter((sample) => sample.timestampMs < cutoffSampleMs);
	// sampleHistory is only pruned to a 10 s window by the periodic tick(), so a trim
	// landing between ticks can find much more than 10 s sitting there. Match what
	// computeRecentAverages() does for the live tiles: only the last 10 s counts,
	// just anchored at the cutoff instead of "now".
	const windowStart = cutoffSampleMs - TEN_SECONDS_MS;
	const averages = computeAverages(
		sampleHistory.filter((sample) => sample.timestampMs >= windowStart)
	);
	recentAveragesStore.set(averages);
	mosAverageStore.set(
		calculateMosScore(
			averages.averageLatencyMs,
			averages.averageJitterMs,
			averages.packetLossPercent
		)
	);
};

export const loadSessionSummaries = (probes: RawProbe[]): void => {
	if (probes.length === 0) return;

	const TEN_S = 10_000;
	const origin = probes[0].sentAt;
	const buckets = new Map<number, RawProbe[]>();

	for (const p of probes) {
		const bucket = Math.floor((p.sentAt - origin) / TEN_S);
		const list = buckets.get(bucket) ?? [];
		list.push(p);
		buckets.set(bucket, list);
	}

	const summaries: TenSecondSummary[] = [];

	for (const [bucket, ps] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
		const received = ps.filter((p) => p.receivedAt !== null);
		const lost = ps.filter((p) => p.receivedAt === null).length;
		const total = ps.length;

		const packetLossPercent = total > 0 ? (lost / total) * 100 : null;

		let latencySum = 0;
		let jitterSum = 0;
		let prevLatency: number | null = null;

		for (const p of received) {
			const latency = p.receivedAt! - p.sentAt;
			latencySum += latency;
			if (prevLatency !== null) {
				jitterSum += Math.abs(latency - prevLatency);
			}
			prevLatency = latency;
		}

		const avgLatency = received.length > 0 ? latencySum / received.length : null;
		const avgJitter = received.length > 1 ? jitterSum / (received.length - 1) : null;
		const mos = calculateMosScore(avgLatency, avgJitter, packetLossPercent);

		summaries.push({
			at: origin + bucket * TEN_S,
			mos,
			packetLossPercent,
			averageLatencyMs: avgLatency,
			averageJitterMs: avgJitter
		});
	}

	summaryHistoryStore.set(summaries.slice(-MAX_HISTORY_SAMPLES));
};
