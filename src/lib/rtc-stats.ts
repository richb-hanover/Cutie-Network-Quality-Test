export type StatsSummary = {
	timestamp: number;
	bytesSent: number;
	bytesReceived: number;
	packetsSent: number;
	packetsReceived: number;
	messagesSent: number;
	messagesReceived: number;
	currentRoundTripTime: number | null;
};

function summarize(report: RTCStatsReport): StatsSummary {
	const summary: StatsSummary = {
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

export function startStatsReporter(
	peer: RTCPeerConnection,
	callback: (summary: StatsSummary, report: RTCStatsReport) => void,
	intervalMs = 1_000
): () => void {
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
