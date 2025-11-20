async function disconnect(
	reason: 'manual' | 'timeout' | 'error' | 'auto' | 'reload' = 'timeout',
	options: { message?: string; suppressMessage?: boolean } = {}
) {
	console.log(`disconnect called: ${reason}, ${JSON.stringify(options)}`);
	if (isDisconnecting) {
		return;
	}
	isDisconnecting = true;
	activeDisconnectReason = reason;

	let savedCsv: string | null = null;

	latencyProbe.stop();
	stopStats?.();
	stopStats = null;
	clearCollectionAutoStopTimer();

	if (connection) {
		try {
			await connection.close();
		} catch (closeError) {
			console.error('Failed to close connection', closeError);
		}
		connection = null;
	}

	connectionId = null;
	connectionState = 'disconnected';
	iceConnectionState = 'new';
	dataChannelState = 'closed';

	if (!options.suppressMessage) {
		if (reason === 'manual') {
			collectionStatusMessage = 'Collection stopped manually';
		} else if (reason === 'timeout') {
			const referenceStart = collectionStartAt ?? Date.now();
			const elapsedMs = Date.now() - referenceStart;
			const minutes = Math.max(1, Math.ceil(elapsedMs / 60000));
			collectionStatusMessage = `Collection stopped after ${minutes} minute${minutes === 1 ? '' : 's'}`;
		} else if (reason === 'auto') {
			collectionStatusMessage = 'Collection stopped after two hours.';
			// } else if (reason === 'error') {
			// 	const detail = options.message?.trim();
			// 	collectionStatusMessage = `Collection stopped: ${detail && detail.length > 0 ? detail : 'Unknown error'}`;
		}
	}

	if (reason === 'error' && options.message) {
		errorMessage = options.message;
		console.log(`got other error: ${errorMessage}`);
	} else if (reason !== 'error') {
		errorMessage = '';
	}

	if (isCreateDataMode && recordedProbes.length > 0) {
		savedCsv = downloadLatencyProbeCsv(recordedProbes);
		recordedProbes = [];
	}

	resetMosData({ clearHistory: false });
	isDisconnecting = false;

	if (savedCsv && !options.suppressMessage) {
		const prefix = collectionStatusMessage ? `${collectionStatusMessage} ` : '';
		collectionStatusMessage = `${prefix}Saved latency probe data to ${savedCsv}`;
	}
}
