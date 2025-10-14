function summarize(report) {
	const summary = {
		timestamp: Date.now(),
		bytesSent: 0,
		bytesReceived: 0,
		packetsSent: 0,
		packetsReceived: 0,
		messagesSent: 0,
		messagesReceived: 0,
		currentRoundTripTime: null
	};

	report.forEach((stat) => {
		if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
			summary.bytesSent = stat.bytesSent ?? summary.bytesSent;
			summary.bytesReceived = stat.bytesReceived ?? summary.bytesReceived;
			summary.packetsSent = stat.packetsSent ?? summary.packetsSent;
			summary.packetsReceived = stat.packetsReceived ?? summary.packetsReceived;
			summary.currentRoundTripTime = stat.currentRoundTripTime ?? summary.currentRoundTripTime;
		}

		if (stat.type === 'data-channel') {
			summary.messagesSent = stat.messagesSent ?? summary.messagesSent;
			summary.messagesReceived = stat.messagesReceived ?? summary.messagesReceived;
		}
	});

	return summary;
}

/**
 * Polls getStats on an interval and invokes the callback with a summary.
 * @param {RTCPeerConnection} peer
 * @param {(summary: ReturnType<typeof summarize>, report: RTCStatsReport) => void} callback
 * @param {number} intervalMs
 * @returns {() => void} stop function
 */
function startStatsReporter(peer, callback, intervalMs = 1_000) {
	let stopped = false;

	async function poll() {
		if (stopped || peer.connectionState === 'closed') {
			return;
		}

		try {
			const report = await peer.getStats();
			callback(summarize(report), report);
		} catch (error) {
			console.error('Failed to collect WebRTC stats', error);
		}

		if (!stopped) {
			setTimeout(poll, intervalMs);
		}
	}

	setTimeout(poll, intervalMs);

	return () => {
		stopped = true;
	};
}

if (typeof window !== 'undefined') {
	window.RtcStats = Object.freeze({
		startStatsReporter
	});
}
