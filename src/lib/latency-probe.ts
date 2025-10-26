export const LATENCY_INTERVAL_MS = 100; // msec
export const LOSS_TIMEOUT_MS = 2000; // msec
export const LOSS_CHECK_INTERVAL_MS = 250; // msec
export const MAX_LATENCY_HISTORY = 1000; // depth of history

// the wire format for the probes sent/received
export type LatencyProbe = {
	type: string; // always "latency-probe"
	seq: number; // sequence number, starts at zero
	sentAt: number; // time actually sent
};
export type LatencySample = {
	seq: number;
	status: 'received' | 'lost';
	latencyMs: number | null;
	jitterMs: number | null;
	at: string;
	timestampMs: number;
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

/**
 * Interesting functions regarding collection of stats
 */
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
	onSamples?: (samples: LatencySample[]) => void;
	collectSamples?: boolean;
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

/**
 * createLatencyMonitor - initialize a WebRTC test.
 * 	Accept any passed-in options
 *  Set up the stuff ?????
 *  Return a LatencyMonitor with the interesting internal functions
 *
 * @param options - default is {}
 * @returns LatencyMonitor
 */
export function initializeLatencyMonitor(options: LatencyMonitorOptions = {}): LatencyMonitor {
	const {
		intervalMs = LATENCY_INTERVAL_MS,
		lossTimeoutMs = LOSS_TIMEOUT_MS,
		lossCheckIntervalMs = LOSS_CHECK_INTERVAL_MS,
		historySize = MAX_LATENCY_HISTORY,
		onStats,
		onSamples,
		collectSamples = true,
		now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
		formatTimestamp = () => new Date().toLocaleTimeString(),
		logger = (error: unknown) => console.error('latency probe: ', error)
	} = options;

	const pendingProbes = new Map<number, number>();

	let latencyStats = createEmptyLatencyStats();
	let totalLatencyMs = 0;
	let jitterEstimateMs = 0;
	let nextSeq = 0;
	let activeChannel: RTCDataChannel | null = null;
	let sendInterval: ReturnType<typeof setInterval> | null = null;
	let lossInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * appendHistory() - add new samples into the latencyStats.history
	 *   trim to historySize if too many to fit
	 * @param samples LatencySample() - new samples to add to the
	 * @returns LatencySample[] - up to historySize samples
	 */
	const appendHistory = (samples: LatencySample[]): LatencySample[] => {
		const merged = [...latencyStats.history, ...samples];
		return merged.length > historySize ? merged.slice(-historySize) : merged;
	};

	/**
	 * integrateSamples() - take a fresh batch of samples (0, 1, or more)
	 *   and integrate them properly into mosStore ?????
	 * @param samples - the samples to process
	 * @param mutate - function to call on mosStore to add new info ?????
	 * @returns
	 */
	const integrateSamples = (
		samples: LatencySample[],
		mutate: (previous: LatencyStats, history: LatencySample[]) => LatencyStats
	) => {
		if (samples.length === 0) {
			return;
		}
		const previous = latencyStats;
		const history = collectSamples ? appendHistory(samples) : previous.history;
		latencyStats = mutate(previous, history);
		onSamples?.(samples);
		emitStats();
	};

	/**
	 * emitStats() - send the current LatencyStats to whoever wants to see them
	 */
	const emitStats = () => {
		onStats?.(latencyStats);
	};

	/**
	 * clearTimers() - turn off all the timers
	 */
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

	/**
	 * resetCollection() - clean out all the stats
	 *    to be ready to re-start collection
	 */
	const resetCollection = () => {
		latencyStats = createEmptyLatencyStats();
		totalLatencyMs = 0;
		jitterEstimateMs = 0;
		nextSeq = 0;
		pendingProbes.clear();
		latencyStats = { ...latencyStats };
		emitStats();
	};

	/**
	 * stopCollection() - stop the collection process
	 *    preserving all the data in the charts
	 */
	const stopCollection = () => {
		clearTimers();
		pendingProbes.clear();
		activeChannel = null;
		latencyStats = { ...latencyStats, history: [...latencyStats.history] };
		emitStats();
	};

	/**
	 * recordLostProbes() - periodically scan pendingProbes
	 *    Look for probes that have timed out
	 * @returns void
	 */
	const recordLostProbes = () => {
		const currentTime = now();
		const lost: number[] = [];

		// push probes that been timed out into lost array
		for (const [seq, sentAt] of pendingProbes) {
			if (currentTime - sentAt > lossTimeoutMs) {
				lost.push(seq);
			}
		}

		if (lost.length === 0) {
			return;
		}

		// delete the lost probes from pendingProbes Map
		for (const seq of lost) {
			pendingProbes.delete(seq);
		}

		// lostSamples array contains info about those lost samples
		const lostSamples: LatencySample[] = lost.map((seq) => ({
			seq,
			status: 'lost',
			latencyMs: null,
			jitterMs: null,
			at: formatTimestamp(),
			timestampMs: currentTime
		}));

		// and integrate them into the mosStore
		integrateSamples(lostSamples, (previous, history) => ({
			...previous,
			totalLost: previous.totalLost + lost.length,
			history
		}));
	};

	/**
	 * startCollection() - begin data collection.
	 * - Stop any current collection
	 * - Set the activeChannel to the passed-in channel
	 * - Reset (something????)
	 * - Send a LatencyProbe and set an interval to send another probe after intervalMs
	 * - Set a timer interval to check timeouts (after lossCheckIntervalMs)
	 * @param channel
	 * @returns
	 */
	const startCollection = (channel: RTCDataChannel) => {
		if (activeChannel === channel && sendInterval) {
			console.log(`start: returned because active && sendInterval`);
			return;
		}

		stopCollection();
		activeChannel = channel;
		resetCollection();

		/**
		 * sendProbe() - initialize a new LatencyProbe
		 *   send it into activeChannel
		 * @returns void
		 */
		const sendProbe = () => {
			if (!activeChannel || activeChannel.readyState !== 'open') {
				console.log(`sendProbe: returned because no channel or not open`);
				return;
			}

			const seq = nextSeq++;
			const sentAt = now(); // uses performance.now() in preference to Date.now()

			// stringify a new LatencyProbe
			const payload = JSON.stringify({
				type: 'latency-probe',
				seq,
				sentAt: sentAt
			});

			// send the probe, add it to pendingProbes, update and emit latencyStats
			try {
				activeChannel.send(payload);
				pendingProbes.set(seq, sentAt);
				// why not latencyStats.totalSent += 1 ??????
				latencyStats = {
					...latencyStats,
					totalSent: latencyStats.totalSent + 1
				};
				emitStats();
			} catch (err) {
				logger(err);
			}
		};

		// actually send the LatencyProbe and schedule the time to re-send
		sendProbe();
		sendInterval = setInterval(sendProbe, intervalMs);
		lossInterval = setInterval(recordLostProbes, lossCheckIntervalMs);
	};

	/**
	 * receiveProbe() - process a LatencyProbe when it arrives
	 * @param payload - the returned LatencyProbe
	 * @returns true if we handled it; false otherwise
	 *     Why would we ever return false ?????
	 * 		 Who cares if we return false ?????
	 */
	const receiveProbe = (payload: string): boolean => {
		let parsed: unknown;

		try {
			parsed = JSON.parse(payload);
			// console.log(`****** Received: ${payload} at ${now()}`);
		} catch {
			logger(`receiveProbe received non-JSON: ${payload}`);
			return false; // and tell the world that we didn't handle it
		}

		if (
			!parsed ||
			typeof parsed !== 'object' ||
			!(parsed as { type?: unknown }).type ||
			(parsed as { type: unknown }).type !== 'latency-probe' ||
			typeof (parsed as { seq?: unknown }).seq !== 'number'
		) {
			logger(`receiveProbe received bad payload: ${payload}`);
			return false;
		}

		// get the sequence number of the received probe
		// and look to see if it's in the pendingProbes MAP
		// set seq = parsed.seq (forcing it to be treated as {seq: number})
		const seq = (parsed as { seq: number }).seq;
		const startedAt = pendingProbes.get(seq);

		// if not, (where did it come from?????) say we handled it
		if (startedAt === undefined) {
			logger(`receiveProbe received non-existent sequence: ${seq}`);
			return true;
		}

		pendingProbes.delete(seq); // remove it from pendingProbes

		/**
		 * this is where the actual measurements occur
		 */
		const receivedAt = now();
		const latencyMs = receivedAt - startedAt;
		totalLatencyMs += latencyMs;
		const totalReceived = latencyStats.totalReceived + 1;
		const previousLatency = latencyStats.lastLatencyMs;

		// compute the jitter (difference from last latency reading)
		// smooth it a bit
		if (previousLatency !== null) {
			const delta = Math.abs(latencyMs - previousLatency);
			jitterEstimateMs += (delta - jitterEstimateMs) / 16;
		} else {
			jitterEstimateMs = 0;
		}

		const jitterMs = previousLatency !== null ? jitterEstimateMs : 0;

		// create a LatencySample with the newly-arrived values
		const sample: LatencySample = {
			seq,
			status: 'received',
			latencyMs,
			jitterMs,
			at: formatTimestamp(),
			timestampMs: receivedAt
		};

		integrateSamples([sample], (previous, history) => ({
			...previous,
			lastLatencyMs: latencyMs,
			totalReceived,
			averageLatencyMs: totalLatencyMs / totalReceived,
			jitterMs,
			history
		}));
		return true;
	};

	/**
	 * return from LatencyMonitor - hand back the interesting functions
	 */
	return {
		start: startCollection,
		stop: stopCollection,
		reset: resetCollection,
		handleMessage: receiveProbe,
		getStats: () => latencyStats
	};
}
