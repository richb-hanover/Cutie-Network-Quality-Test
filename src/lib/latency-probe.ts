export const LATENCY_INTERVAL_MS = 5000; // msec
export const LOSS_TIMEOUT_MS = 2000; // msec
export const LOSS_CHECK_INTERVAL_MS = 250; // msec
export const MAX_LATENCY_HISTORY = 25; // depth of history

export type LatencySample = {
	seq: number;
	status: 'received' | 'lost';
	latencyMs: number | null;
	jitterMs: number | null;
	at: string;
};

export type LatencyStats = {
	lastLatencyMs: number | null;
	averageLatencyMs: number | null;
	jitterMs: number | null;
	totalSent: number;
	totalReceived: number;
	totalLost: number;
	history: LatencySample[];
};

export type LatencyMonitor = {
	start: (channel: RTCDataChannel) => void;
	stop: () => void;
	reset: () => void;
	handleMessage: (payload: string) => boolean;
	getStats: () => LatencyStats;
};

type LatencyMonitorOptions = {
	intervalMs?: number;
	lossTimeoutMs?: number;
	lossCheckIntervalMs?: number;
	historySize?: number;
	onStats?: (stats: LatencyStats) => void;
	now?: () => number;
	formatTimestamp?: () => string;
	logger?: (error: unknown) => void;
};

export function createEmptyLatencyStats(): LatencyStats {
	return {
		lastLatencyMs: null,
		averageLatencyMs: null,
		jitterMs: null,
		totalSent: 0,
		totalReceived: 0,
		totalLost: 0,
		history: []
	};
}

export function createLatencyMonitor(options: LatencyMonitorOptions = {}): LatencyMonitor {
	const {
		intervalMs = LATENCY_INTERVAL_MS,
		lossTimeoutMs = LOSS_TIMEOUT_MS,
		lossCheckIntervalMs = LOSS_CHECK_INTERVAL_MS,
		historySize = MAX_LATENCY_HISTORY,
		onStats,
		now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
		formatTimestamp = () => new Date().toLocaleTimeString(),
		logger = (error: unknown) => console.error('latency probe: ', error)
	} = options;

	const pendingPings = new Map<number, number>();

	let latencyStats = createEmptyLatencyStats();
	let totalLatencyMs = 0;
	let jitterEstimateMs = 0;
	let nextSeq = 0;
	let activeChannel: RTCDataChannel | null = null;
	let sendInterval: ReturnType<typeof setInterval> | null = null;
	let lossInterval: ReturnType<typeof setInterval> | null = null;

	const appendHistory = (samples: LatencySample[]): LatencySample[] => {
		const merged = [...latencyStats.history, ...samples];
		return merged.length > historySize ? merged.slice(-historySize) : merged;
	};

	const emitStats = () => {
		onStats?.(latencyStats);
	};

	const clearTimers = () => {
		if (sendInterval) {
			clearInterval(sendInterval);
			sendInterval = null;
		}
		if (lossInterval) {
			clearInterval(lossInterval);
			lossInterval = null;
		}
	};

	const reset = () => {
		latencyStats = createEmptyLatencyStats();
		totalLatencyMs = 0;
		jitterEstimateMs = 0;
		nextSeq = 0;
		pendingPings.clear();
		latencyStats = { ...latencyStats };
		emitStats();
	};

	const stop = () => {
		clearTimers();
		pendingPings.clear();
		activeChannel = null;
		latencyStats = { ...latencyStats, history: [...latencyStats.history] };
		emitStats();
	};

	const recordLostPings = () => {
		const currentTime = now();
		const lost: number[] = [];

		for (const [seq, sentAt] of pendingPings) {
			if (currentTime - sentAt > lossTimeoutMs) {
				lost.push(seq);
			}
		}

		if (lost.length === 0) {
			return;
		}

		for (const seq of lost) {
			pendingPings.delete(seq);
		}

		const lostSamples: LatencySample[] = lost.map((seq) => ({
			seq,
			status: 'lost',
			latencyMs: null,
			jitterMs: null,
			at: formatTimestamp()
		}));

		latencyStats = {
			...latencyStats,
			totalLost: latencyStats.totalLost + lost.length,
			history: appendHistory(lostSamples)
		};
		emitStats();
	};

	const start = (channel: RTCDataChannel) => {
		if (activeChannel === channel && sendInterval) {
			console.log(`start: returned because active && sendInterval`);
			return;
		}

		stop();
		activeChannel = channel;
		reset();

		const sendProbe = () => {
			if (!activeChannel || activeChannel.readyState !== 'open') {
				console.log(`sendProbe: returned because no channel or not open`);
				return;
			}

			const seq = nextSeq++;
			const sentAt = now();

			const payload = JSON.stringify({
				type: 'latency-probe',
				seq,
				t0: sentAt,
				sentAt: now()
			});

			try {
				console.log(`Sent: ********** ${payload}`);
				activeChannel.send(payload);
				pendingPings.set(seq, sentAt);
				latencyStats = {
					...latencyStats,
					totalSent: latencyStats.totalSent + 1
				};
				emitStats();
			} catch (err) {
				logger(err);
			}
		};

		sendProbe();
		sendInterval = setInterval(sendProbe, intervalMs);
		lossInterval = setInterval(recordLostPings, lossCheckIntervalMs);
	};

	const handleMessage = (payload: string): boolean => {
		let parsed: unknown;

		try {
			parsed = JSON.parse(payload);
			console.log(`****** Received: ${payload} at ${now()}`);
		} catch {
			return false;
		}

		if (
			!parsed ||
			typeof parsed !== 'object' ||
			!(parsed as { type?: unknown }).type ||
			(parsed as { type: unknown }).type !== 'latency-probe' ||
			typeof (parsed as { seq?: unknown }).seq !== 'number'
		) {
			return false;
		}

		const seq = (parsed as { seq: number }).seq;
		const startedAt = pendingPings.get(seq);

		if (startedAt === undefined) {
			return true;
		}

		pendingPings.delete(seq);

		const latencyMs = now() - startedAt;
		totalLatencyMs += latencyMs;
		const totalReceived = latencyStats.totalReceived + 1;
		const previousLatency = latencyStats.lastLatencyMs;

		if (previousLatency !== null) {
			const delta = Math.abs(latencyMs - previousLatency);
			jitterEstimateMs += (delta - jitterEstimateMs) / 16;
		} else {
			jitterEstimateMs = 0;
		}

		const jitterMs = previousLatency !== null ? jitterEstimateMs : 0;

		const sample: LatencySample = {
			seq,
			status: 'received',
			latencyMs,
			jitterMs,
			at: formatTimestamp()
		};

		latencyStats = {
			...latencyStats,
			lastLatencyMs: latencyMs,
			totalReceived,
			averageLatencyMs: totalLatencyMs / totalReceived,
			jitterMs,
			history: appendHistory([sample])
		};
		emitStats();
		return true;
	};

	return {
		start,
		stop,
		reset,
		handleMessage,
		getStats: () => latencyStats
	};
}
