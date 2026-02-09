import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import wrtc from '@roamhq/wrtc';
import { incrementWebrtcConnections } from '$lib/server/runtimeState';
import {
	connections,
	finalizeConnection,
	type ManagedConnection
} from '$lib/server/webrtcRegistry';
import { getLogger } from '../../../lib/logger';
const logger = getLogger('server');

/**
 * When the client requests the main page ("/"), it immediately makes a POST
 * to /api/webrtc, containing an SDP offer with ICE candidates that the
 * server (this end) can use to establish a complete WebRTC connection.
 *
 * The server then creates a response with an answer SDP with its candidates
 * (that are available to communicate) along with some kind of connection ID.
 * The client then proceeds to send latency probes that connection ID
 *
 * Finally, the server end sets up an onmessage() handler that simply echoes
 * the latency probes back to the client.
 */

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const SERVER_ICE_GATHER_TIMEOUT_MS = 10_000;

/**
 * Wait for the server's ICE gathering to complete before sending the
 * HTTP response, so that all server candidates are included.
 */
function waitForServerIceGathering(pc: RTCPeerConnection): Promise<void> {
	return new Promise((resolve) => {
		if (pc.iceGatheringState === 'complete') {
			resolve();
			return;
		}

		const timeout = setTimeout(() => {
			logger.info(
				`Server ICE gathering timeout after ${SERVER_ICE_GATHER_TIMEOUT_MS}ms. State: ${pc.iceGatheringState}`
			);
			resolve();
		}, SERVER_ICE_GATHER_TIMEOUT_MS);

		pc.onicegatheringstatechange = () => {
			logger.debug(`Server ICE gathering state: ${pc.iceGatheringState}`);
			if (pc.iceGatheringState === 'complete') {
				clearTimeout(timeout);
				resolve();
			}
		};
	});
}

function normaliseLocalCandidate(candidate: RTCIceCandidateInit): RTCIceCandidateInit {
	if (!candidate?.candidate) {
		return candidate;
	}

	const parts = candidate.candidate.split(' ');
	if (parts.length < 5) {
		return candidate;
	}

	const address = parts[4];
	if (
		!address ||
		(!address.endsWith('.local') &&
			address !== 'localhost' &&
			address !== '::1' &&
			address !== '[::1]')
	) {
		return candidate;
	}

	return {
		...candidate,
		candidate: candidate.candidate.replace(address, '127.0.0.1')
	};
}
/**
 * registerConnection()
 * @param pc
 * @returns id to reference the connection info
 *
 * registerConnection() takes a new RTCPeerConnection,
 * generates a UUID for it, and wraps the pair of {id, pc}
 * together with the timestamp (startedAt).
 *
 * It then installs an onconnectionstatechange handler:
 * whenever the peer enters a terminal state (closed, failed, or disconnected)
 * the helper logs the state and calls finalizeConnection() to remove it
 * from the active connections map and record its duration for /api/stats.
 *
 * After wiring that cleanup hook, it stores the new ManagedConnection in the
 * connections map keyed by its UUID and returns the ID so the rest of the handler can reference it.
 */
function registerConnection(pc: RTCPeerConnection): string {
	const id = crypto.randomUUID();
	const managed: ManagedConnection = { id, pc, startedAt: new Date(), reason: '' };

	pc.onconnectionstatechange = () => {
		if (
			pc.connectionState === 'closed' ||
			pc.connectionState === 'failed' ||
			pc.connectionState === 'disconnected'
		) {
			logger.info(
				`Connection state ended: state: ${pc.iceConnectionState} gathering: ${pc.iceGatheringState}`
			);
			finalizeConnection(id, `${pc.iceConnectionState} / ${pc.iceGatheringState}`);
		} else {
			logger.info(
				`Connection state changed: state: ${pc.iceConnectionState} gathering: ${pc.iceGatheringState}`
			);
		}
	};

	connections.set(id, managed);
	return id;
}

/**
 * POST() - a POST handler for /api/webrtc
 * POST handles the entire server-side half of SDP exchange,
 * candidate wiring, logging, and connection bookkeeping
 * for each new peer.

 * @param param0 
 * @returns 
 *
	* The handler validates the incoming JSON payload,
	* ensuring it contains a valid SDP offer plus any ICE candidates from the client.
	* Invalid payloads short-circuit with error(400, …).
	* 
	* It creates a new RTCPeerConnection with Google’s public STUN server,
	* wires up logging for ICE/connection state changes, and collects
	* locally generated ICE candidates after normalizing .local addresses to 127.0.0.1.
	* 
	* When the browser opens a data channel, the server logs the remote candidate info,
	* emits a “welcome” message, and echoes back any messages it receives,
	* incrementing the running WebRTC connection count.
	* 
	* The function sets the remote SDP, adds all provided client candidates
	* (and explicitly signals end-of-candidates), then creates a local answer SDP and stores it.
	* During this process it tracks connectionId = registerConnection(pc)
	* so the new peer is managed and cleaned up automatically when it disconnects.
	* 
	* Finally, it responds with status 201 containing the newly generated SDP answer,
	* the assigned connectionId, and the list of gathered local ICE candidates (normalized)
	* so the client can complete ICE negotiation.
 */
export const POST: RequestHandler = async ({ request }) => {
	let offer: RTCSessionDescriptionInit;
	let clientCandidates: RTCIceCandidateInit[] = [];
	let payload;
	try {
		payload = await request.json();
		offer = payload?.offer;
		clientCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
		if (!offer?.type || !offer?.sdp) {
			throw new Error('Invalid offer');
		}
	} catch {
		logger.info(`Expected JSON body with valid WebRTC offer: ${JSON.stringify(payload)}`);
		throw error(400, 'Expected JSON body with valid WebRTC offer');
	}

	let connectionId: string | null = null;

	const pc = new RTCPeerConnection({
		iceServers: [
			{
				urls: 'stun:stun.l.google.com:19302'
			}
		]
	} as RTCConfiguration);

	pc.oniceconnectionstatechange = () => {
		logger.debug(
			`ICE state changed; id: ${connectionId} state: ${pc.iceConnectionState} gathering: ${pc.iceGatheringState}`
		);
	};

	pc.onconnectionstatechange = () => {
		logger.info(
			`Server connection state changed: id: ${connectionId} state: ${pc.connectionState}`
		);
	};

	const localCandidates: RTCIceCandidateInit[] = [];

	pc.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
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

			if (candidateInit?.candidate) {
				const normalised = normaliseLocalCandidate(candidateInit as RTCIceCandidateInit);
				localCandidates.push(normalised);
			}
		}
	};

	pc.onicecandidateerror = (_event: unknown) => {
		const foo: any = _event;
		logger.debug(`Server ICE candidate error ${foo.address} ${foo.errorCode} "${foo.errorText}"`);
	};

	pc.ondatachannel = (event) => {
		const channel = event.channel;

		type RemoteCandidateStats = {
			id: string;
			type: 'remote-candidate';
			ip?: string;
			address?: string;
			port?: number;
			portNumber?: number;
			foundation?: string;
		};

		type CandidatePairStats = {
			id: string;
			type: 'candidate-pair';
			state?: string;
			nominated?: boolean;
			remoteCandidateId?: string;
		};

		const logRemoteAddress = async () => {
			const stats = await pc.getStats();
			const remoteCandidates = new Map<string, RemoteCandidateStats>();
			let selectedPair: CandidatePairStats | null = null;

			stats.forEach((report) => {
				if (report.type === 'remote-candidate') {
					remoteCandidates.set(report.id, report as RemoteCandidateStats);
				} else if (report.type === 'candidate-pair') {
					const pair = report as CandidatePairStats;
					if (pair.state === 'succeeded' && (pair.nominated || !selectedPair)) {
						selectedPair = pair;
					}
				}
			});

			if (!selectedPair) {
				logger.info('No succeeded ICE candidate pair yet', { connectionId });
				return;
			}

			const pair = selectedPair as CandidatePairStats;
			const remote = remoteCandidates.get(pair.remoteCandidateId ?? '');

			if (!remote) {
				logger.info(
					`Selected pair has no matching remote candidate: connectionID: ${connectionId} pair: ${pair.id}`
				);
				return;
			}

			const ip = remote.ip ?? remote.address ?? 'unknown';
			const port = remote.port ?? remote.portNumber ?? 'unknown';

			// logger.info(`Remote ICE Candidate selected: ${JSON.stringify(remote)}`);
			// "${ip}" is frequently "" as some kind of security measure
			logger.debug(
				`Remote ICE candidate selected: connection: ${connectionId} ip: ${ip} port: ${port}`
			);
		};

		// When the data channel opens, send a welcome message
		// (The welcome is not necessary for the protocol, but
		// shows up in the web GUI)
		channel.onopen = () => {
			const state = connectionId ?? 'pending';
			logger.info(`Connection established: ${state}`);
			incrementWebrtcConnections();
			logRemoteAddress().catch((error) => {
				logger.info('Failed to fetch remote ICE stats', { connectionId, error });
			});

			const msg = {
				type: 'welcome',
				message: 'RTC channel established with server',
				at: new Date().toLocaleString()
			};
			channel.send(JSON.stringify(msg));
		};
		channel.onclose = () => {
			logger.debug(`Connection closed: ${connectionId}`);
			// console.log(`Connection closed: ${connectionId}`);
		};
		channel.onerror = () => {
			logger.debug(`Connection error: ${connectionId}`);
			// console.log(`Connection error: ${connectionId}`);
		};

		/**
		 * This is the heart of the backend server
		 * It simply echoes (sends back) every message
		 * it receives. That's it! Really!
		 * All the rest of the magic happens on the client
		 */
		channel.onmessage = (msgEvent) => {
			try {
				JSON.parse(msgEvent.data);
			} catch {
				logger.info(`Message received: ${JSON.stringify(msgEvent)}`);
			}
			channel.send(msgEvent.data);
		};
	};

	const remoteDescription = new RTCSessionDescription(offer);
	await pc.setRemoteDescription(remoteDescription);

	const normalisedClientCandidates = clientCandidates.map((candidate) =>
		normaliseLocalCandidate(candidate)
	);

	for (const candidate of normalisedClientCandidates) {
		try {
			await pc.addIceCandidate(new RTCIceCandidate(candidate));
		} catch (candidateError) {
			logger.warn('Failed to add remote ICE candidate', { candidate, error: candidateError });
		}
	}
	try {
		// Signal that there are no more remote candidates.
		await pc.addIceCandidate(null);
	} catch (finalCandidateError) {
		logger.warn('Failed to finalize remote ICE candidates', finalCandidateError);
	}

	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);
	await waitForServerIceGathering(pc);

	connectionId = registerConnection(pc);

	logger.debug(
		`WebRTC answer ready: ${connectionId} ${pc.iceConnectionState} ${pc.iceGatheringState} (${localCandidates.length} candidates)`
	);

	return json(
		{
			answer: pc.localDescription,
			connectionId,
			candidates: localCandidates.map((candidate) => normaliseLocalCandidate(candidate))
		},
		{
			status: 201
		}
	);
};

export const DELETE: RequestHandler = async ({ url }) => {
	const connectionId = url.searchParams.get('id');
	if (!connectionId) {
		throw error(400, 'Missing connection id');
	}

	const managed = connections.get(connectionId);
	if (!managed) {
		throw error(404, 'Connection not found or already closed');
	}

	logger.debug(`Deleting connection: ${managed.id}`);
	// console.log(`Deleting connection: ${managed.id}`);
	managed.pc.close();
	finalizeConnection(connectionId, 'Client DELETE');

	return json({ closed: true });
};
