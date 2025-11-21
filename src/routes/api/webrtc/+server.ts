import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import wrtc from '@roamhq/wrtc';
import {
	serverStartTime,
	webrtcConnections,
	incrementWebrtcConnections
} from '$lib/server/runtimeState';
import { connections, type ManagedConnection } from '$lib/server/webrtcRegistry';
import { getLogger } from '../../../lib/logger';
const logger = getLogger('server');

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

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

function registerConnection(pc: RTCPeerConnection): string {
	const id = crypto.randomUUID();
	const managed: ManagedConnection = { id, pc, createdAt: new Date() };

	pc.onconnectionstatechange = () => {
		if (
			pc.connectionState === 'closed' ||
			pc.connectionState === 'failed' ||
			pc.connectionState === 'disconnected'
		) {
			logger.debug('Connection state changed', {
				state: pc.iceConnectionState,
				gathering: pc.iceGatheringState
			});
			// console.log('Connection state changed', {
			// 	state: pc.iceConnectionState,
			// 	gathering: pc.iceGatheringState
			// });

			connections.delete(id);
		}
	};

	connections.set(id, managed);
	return id;
}

export const POST: RequestHandler = async ({ request }) => {
	let offer: RTCSessionDescriptionInit;
	let clientCandidates: RTCIceCandidateInit[] = [];
	try {
		const payload = await request.json();
		offer = payload?.offer;
		clientCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
		if (!offer?.type || !offer?.sdp) {
			throw new Error('Invalid offer');
		}
	} catch {
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
		logger.debug('ICE connection state changed', {
			id: connectionId,
			state: pc.iceConnectionState,
			gathering: pc.iceGatheringState,
			connections: connections.size
		});
		console.log('ICE connection state changed', {
			id: connectionId,
			state: pc.iceConnectionState,
			gathering: pc.iceGatheringState,
			connections: connections.size
		});
	};

	pc.onconnectionstatechange = () => {
		logger.debug(`Server connection state changed: ${pc.connectionState}`);
		// console.log(`Server connection state changed: ${pc.connectionState}`);
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
				// console.debug('Server gathered ICE candidate', normalised);
				// logger.info('Server gathered ICE candidate', normalised);
				localCandidates.push(normalised);
			}
		}
	};

	pc.onicecandidateerror = (_event: unknown) => {
		// console.error('Server ICE candidate error', event);
		// logger.info('Server ICE candidate error', _event);
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
				logger.debug('No succeeded ICE candidate pair yet', { connectionId });
				// console.log('No succeeded ICE candidate pair yet', { connectionId });
				return;
			}

			const pair = selectedPair as CandidatePairStats;
			const remote = remoteCandidates.get(pair.remoteCandidateId ?? '');

			if (!remote) {
				logger.debug('Selected pair has no matching remote candidate', {
					connectionId,
					pair: pair.id
				});
				// console.log('Selected pair has no matching remote candidate', {
				// 	connectionId,
				// 	pair: pair.id
				// });

				return;
			}

			const ip = remote.ip ?? remote.address ?? 'unknown';
			const port = remote.port ?? remote.portNumber ?? 'unknown';

			// logger.info(`Remote ICE Candidate selected: ${JSON.stringify(remote)}`);
			// "ip" is frequently "" as some kind of security measure
			logger.debug('Remote ICE candidate selected', {
				connectionId,
				ip,
				port,
				foundation: remote.foundation
			});
			// console.log('Remote ICE candidate selected', {
			// 	connectionId,
			// 	ip,
			// 	port,
			// 	foundation: remote.foundation
			// });
		};

		// When the data channel opens, send a welcome message
		// (The welcome is not necessary for the protocol, but
		// shows up in the web GUI)
		channel.onopen = () => {
			const state = connectionId ?? 'pending';
			logger.info(`Connection established: ${state} (${connections.size} total)`);
			incrementWebrtcConnections();
			logRemoteAddress().catch((error) => {
				logger.info('Failed to fetch remote ICE stats', { connectionId, error });
			});

			channel.send(
				JSON.stringify({
					type: 'welcome',
					message: 'RTC channel established with server',
					at: new Date().toLocaleString(),
					connections: `Current: ${connections.size} Total: ${webrtcConnections} since: ${serverStartTime.toLocaleString()}`
				})
			);
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

	connectionId = registerConnection(pc);

	logger.debug('WebRTC answer ready', {
		connectionId,
		localCandidateCount: localCandidates.length,
		iceConnectionState: pc.iceConnectionState,
		iceGatheringState: pc.iceGatheringState
	});
	// console.log('WebRTC answer ready', {
	// 	connectionId,
	// 	localCandidateCount: localCandidates.length,
	// 	iceConnectionState: pc.iceConnectionState,
	// 	iceGatheringState: pc.iceGatheringState
	// });

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
	connections.delete(connectionId);

	return json({ closed: true });
};
