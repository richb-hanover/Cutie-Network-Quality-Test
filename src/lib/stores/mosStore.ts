import { writable } from 'svelte/store';
import type { LatencySample, LatencyStats } from '$lib/latency-probe';

const TEN_SECONDS_MS = 10_000;

export type RecentAverages = {
	packetLossPercent: number | null;
	averageLatencyMs: number | null;
	averageJitterMs: number | null;
};

export type MosPoint = {
	at: number;
	value: number;
};

const createEmptyAverages = (): RecentAverages => ({
	packetLossPercent: null,
	averageLatencyMs: null,
	averageJitterMs: null
});

const recentAveragesStore = writable<RecentAverages>(createEmptyAverages());
const mosAverageStore = writable<number | null>(null);
const mosHistoryStore = writable<MosPoint[]>([]);

let latestStats: LatencyStats | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const calculatePacketLossPercent = (lost: number, total: number): number | null => {
	if (total === 0) {
		return null;
	}
	return (lost / total) * 100;
};

const computeRecentAverages = (history: LatencySample[]): RecentAverages => {
	const cutoff = performanceNow() - TEN_SECONDS_MS;

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

	const averages = computeRecentAverages(latestStats.history);
	recentAveragesStore.set(averages);

	const mosValue = calculateMosScore(
		averages.averageLatencyMs,
		averages.averageJitterMs,
		averages.packetLossPercent
	);

	mosAverageStore.set(mosValue);

	if (mosValue === null) {
		return;
	}

	const at = Date.now();

	mosHistoryStore.update((history) => {
		const next = [...history, { at, value: mosValue }];
		return next.slice(-300);
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

export const tenSecondMosHistory = {
	subscribe: mosHistoryStore.subscribe
};

export const updateMosLatencyStats = (stats: LatencyStats) => {
	latestStats = stats;
	if (stats.totalSent === 0 && stats.totalReceived === 0 && stats.totalLost === 0) {
		mosHistoryStore.set([]);
		recentAveragesStore.set(createEmptyAverages());
		mosAverageStore.set(null);
	}
	ensureInterval();
};

export const resetMosData = (options?: { clearHistory?: boolean }) => {
	latestStats = null;
	if (options?.clearHistory !== false) {
		recentAveragesStore.set(createEmptyAverages());
		mosAverageStore.set(null);
		mosHistoryStore.set([]);
	} else {
		mosAverageStore.set(null);
		recentAveragesStore.set(createEmptyAverages());
	}
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
};
