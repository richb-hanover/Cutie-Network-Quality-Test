const DEFAULT_SIGNAL_URL = '/api/webrtc';
const ICE_GATHER_TIMEOUT_MS = 15_000;

function shouldNormaliseAddress(address) {
	if (!address) {
		return false;
	}

	const value = address.toLowerCase();
	return value.endsWith('.local') || value === 'localhost' || value === '::1' || value === '[::1]';
}

function normaliseCandidateString(candidateString) {
	if (!candidateString) {
		return { candidate: candidateString, replaced: false };
	}

	const prefix = 'candidate:';
	const hasPrefix = candidateString.startsWith(prefix);
	const body = hasPrefix ? candidateString.slice(prefix.length) : candidateString;
	const parts = body.trim().split(/\s+/);

	if (parts.length < 6) {
		return { candidate: candidateString, replaced: false };
	}

	const addressIndex = 4;
	const typeIndex = parts.indexOf('typ');
	const candidateType = typeIndex !== -1 ? parts[typeIndex + 1] : undefined;
	const address = parts[addressIndex];

	if (candidateType !== 'host' || !shouldNormaliseAddress(address)) {
		return { candidate: candidateString, replaced: false };
	}

	parts[addressIndex] = '127.0.0.1';
	const rebuiltBody = parts.join(' ');
	const rebuilt = hasPrefix ? `${prefix}${rebuiltBody}` : rebuiltBody;

	return {
		candidate: rebuilt,
		replaced: true
	};
}

function normaliseSdpCandidates(sdp) {
	if (!sdp) {
		return { sdp, replacements: 0 };
	}

	let replacements = 0;

	const normalised = sdp.replace(/^a=candidate:.*$/gm, (line) => {
		const candidatePart = line.slice(2).trim();
		const { candidate, replaced } = normaliseCandidateString(candidatePart);
		if (replaced) {
			replacements += 1;
		}
		return `a=${candidate}`;
	});

	return { sdp: normalised, replacements };
}

function extractCandidatesFromSdp(sdp) {
	if (!sdp) {
		return [];
	}

	const candidates = [];
	let currentMid = null;
	let currentMLineIndex = -1;

	for (const line of sdp.split(/\r?\n/)) {
		if (line.startsWith('m=')) {
			currentMLineIndex += 1;
		} else if (line.startsWith('a=mid:')) {
			currentMid = line.slice('a=mid:'.length).trim();
		} else if (line.startsWith('a=candidate:')) {
			candidates.push(
				normaliseLocalCandidate({
					candidate: line.slice(2).trim(),
					sdpMid: currentMid ?? undefined,
					sdpMLineIndex: currentMLineIndex >= 0 ? currentMLineIndex : undefined
				})
			);
		}
	}

	return candidates;
}

function extractCandidateInfo(candidateInit) {
	if (!candidateInit?.candidate) {
		return null;
	}

	const parts = candidateInit.candidate.trim().split(/\s+/);
	if (parts.length < 8) {
		return null;
	}

	const typeIndex = parts.indexOf('typ');
	const addressIndex = 4;
	const portIndex = 5;

	return {
		type: typeIndex !== -1 ? parts[typeIndex + 1] : 'unknown',
		address: parts[addressIndex],
		port: parts[portIndex],
		protocol: parts[2],
		raw: candidateInit.candidate
	};
}

function logCandidate(stage, candidateInit) {
	const info = extractCandidateInfo(candidateInit);
	if (!info) {
		console.info(`[RTC] ${stage} ICE candidate`, candidateInit);
		return;
	}

	console.info(`[RTC] ${stage} ICE candidate (${info.type})`, {
		address: info.address,
		port: info.port,
		protocol: info.protocol,
		raw: info.raw
	});
}

function logGatheringSummary(stage, candidates) {
	const counts = candidates.reduce((acc, candidateInit) => {
		const info = extractCandidateInfo(candidateInit);
		if (!info) {
			acc.unknown = (acc.unknown ?? 0) + 1;
			return acc;
		}
		acc[info.type] = (acc[info.type] ?? 0) + 1;
		return acc;
	}, {});

	console.info(`[RTC] ${stage} ICE gathering complete`, {
		total: candidates.length,
		types: counts
	});
}

function normaliseLocalCandidate(candidateInit) {
	if (!candidateInit?.candidate) {
		return candidateInit;
	}

	const { candidate, replaced } = normaliseCandidateString(candidateInit.candidate);
	if (!replaced) {
		return candidateInit;
	}

	return {
		...candidateInit,
		candidate
	};
}

function waitForIceGatheringComplete(peer) {
	if (peer.iceGatheringState === 'complete') {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		const finish = () => {
			console.log('ICE gathering finished. Final state:', peer.iceGatheringState);
			clearTimeout(timeout);
			peer.removeEventListener?.('icegatheringstatechange', handleStateChange);
			resolve();
		};

		const handleStateChange = () => {
			console.log('ICE gathering state changed to:', peer.iceGatheringState);
			if (peer.iceGatheringState === 'complete') {
				finish();
			}
		};

		// const timeout = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
		
		const timeout = setTimeout(() => {
      console.log('ICE gathering TIMEOUT. State:', peer.iceGatheringState);
      finish();
    }, ICE_GATHER_TIMEOUT_MS);
		
		if (peer.addEventListener) {
			peer.addEventListener('icegatheringstatechange', handleStateChange);
		} else {
			const original = peer.onicegatheringstatechange;
			peer.onicegatheringstatechange = (...args) => {
				handleStateChange();
				original?.apply(peer, args);
			};
		}
	});
}

async function negotiate(peer, signalUrl, connectionInit) {
	const gatheredCandidates = [];
	const candidateListener = (event) => {
		if (event.candidate) {
			const candidateInit =
				typeof event.candidate.toJSON === 'function'
					? event.candidate.toJSON()
					: {
							candidate: event.candidate.candidate,
							sdpMid: event.candidate.sdpMid ?? undefined,
							sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
							usernameFragment: event.candidate.usernameFragment ?? undefined
						};

			if (candidateInit.candidate) {
				logCandidate('Local', candidateInit);
				gatheredCandidates.push(normaliseLocalCandidate(candidateInit));
			}
		}
	};

	let originalCandidateHandler = null;

	if (peer.addEventListener) {
		peer.addEventListener('icecandidate', candidateListener);
	} else {
		originalCandidateHandler = peer.onicecandidate;
		peer.onicecandidate = (...args) => {
			if (args[0]?.candidate) {
				const candidate = args[0].candidate;
				const candidateInit =
					typeof candidate.toJSON === 'function'
						? candidate.toJSON()
						: {
								candidate: candidate.candidate,
								sdpMid: candidate.sdpMid ?? undefined,
								sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
								usernameFragment: candidate.usernameFragment ?? undefined
							};

				if (candidateInit.candidate) {
					logCandidate('Local', candidateInit);
					gatheredCandidates.push(normaliseLocalCandidate(candidateInit));
				}
			}
			originalCandidateHandler?.apply(peer, args);
		};
	}

	const dataChannel = peer.createDataChannel(connectionInit?.label ?? 'client-data');
	const channelPromise = new Promise((resolve) => {
		dataChannel.onopen = () => resolve(dataChannel);
	});

	if (connectionInit?.onDataChannelMessage) {
		dataChannel.onmessage = (event) => connectionInit.onDataChannelMessage(event, dataChannel);
	}

	if (connectionInit?.onDataChannelOpen) {
		dataChannel.addEventListener?.('open', () => connectionInit.onDataChannelOpen?.(dataChannel));
	} else if (connectionInit?.onDataChannelOpen === null) {
		// explicit no-op
	}

	if (connectionInit?.onDataChannelClose) {
		dataChannel.onclose = () => connectionInit.onDataChannelClose?.(dataChannel);
	}

	const offer = await peer.createOffer();
	await peer.setLocalDescription(offer);
	await waitForIceGatheringComplete(peer);

	const localDescription = peer.localDescription;
	if (!localDescription) {
		throw new Error('Local description is missing after ICE gathering');
	}

	const { sdp: normalisedSdp, replacements } = normaliseSdpCandidates(localDescription.sdp ?? '');
	if (replacements > 0) {
		console.info(`[RTC] Normalised ${replacements} candidate(s) in local SDP`);
	}

	let candidatePayload = gatheredCandidates;
	if (candidatePayload.length === 0) {
		candidatePayload = extractCandidatesFromSdp(normalisedSdp);
		if (candidatePayload.length > 0) {
			console.info(`[RTC] Derived ${candidatePayload.length} candidate(s) from SDP`);
		}
	}

	logGatheringSummary('Local', candidatePayload);

	const response = await fetch(signalUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			offer: {
				type: localDescription.type,
				sdp: normalisedSdp
			},
			candidates: candidatePayload
		})
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Signalling server error (${response.status}): ${message}`);
	}

	const { answer, connectionId, candidates: remoteCandidates = [] } = await response.json();
	await peer.setRemoteDescription(answer);

	for (const candidate of remoteCandidates) {
		if (!candidate?.candidate) {
			continue;
		}
		try {
			const normalised = normaliseLocalCandidate(candidate);
			logCandidate('Remote', normalised);
			await peer.addIceCandidate(new RTCIceCandidate(normalised));
		} catch (err) {
			console.warn('Failed to add server ICE candidate', err);
		}
	}
	try {
		await peer.addIceCandidate(null);
	} catch (err) {
		console.warn('Failed to finalize server ICE candidates', err);
	}

	await channelPromise;

	if (peer.removeEventListener) {
		peer.removeEventListener('icecandidate', candidateListener);
	} else {
		peer.onicecandidate = originalCandidateHandler;
	}

	return {
		connectionId,
		dataChannel
	};
}

/**
 * Creates a WebRTC connection to the server.
 * @param {Object} options
 * @param {RTCConfiguration} [options.rtcConfig]
 * @param {string} [options.signalUrl]
 * @param {function} [options.onMessage]
 * @param {function} [options.onOpen]
 * @param {function} [options.onError]
 * @returns {Promise<{ peerConnection: RTCPeerConnection, dataChannel: RTCDataChannel, connectionId: string, close: () => Promise<void> }>}
 */
async function createServerConnection(options = {}) {
	const {
		rtcConfig,
		signalUrl = DEFAULT_SIGNAL_URL,
		onMessage,
		onOpen,
		onError
	} = options;

	const peer = new RTCPeerConnection(
		rtcConfig ?? {
			iceServers: [
				{
					urls: 'stun:stun.l.google.com:19302'
				}
			]
		}
	);

	peer.onconnectionstatechange = () => {
		if (peer.connectionState === 'failed') {
			onError?.(new Error('WebRTC connection failed'));
		}
	};

	const { connectionId, dataChannel } = await negotiate(peer, signalUrl, {
		onDataChannelMessage: onMessage,
		onDataChannelOpen: onOpen,
		onDataChannelClose: () => onError?.(new Error('Data channel closed'))
	});

	async function close() {
		try {
			dataChannel.close();
		} catch (_) {
			// ignore channel close errors
		}
		peer.close();
		try {
			await fetch(`${signalUrl}?id=${encodeURIComponent(connectionId)}`, {
				method: 'DELETE'
			});
		} catch (_) {
			// ignore network errors on cleanup
		}
	}

	return {
		peerConnection: peer,
		dataChannel,
		connectionId,
		close
	};
}

if (typeof window !== 'undefined') {
	window.RtcClient = Object.freeze({
		createServerConnection
	});
}
