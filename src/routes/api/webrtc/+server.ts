import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import wrtc from '@roamhq/wrtc';
import { dev } from '$app/environment';
import { execSync } from 'node:child_process';
import { getLogger } from '../../../lib/logger';
const logger = getLogger('server');

/**
 * Start of the main server process
 */
import version from '../../../../package.json';
let gitCommit = '';
if (dev) {
	try {
		gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
	} catch (error) {
		console.warn('Unable to determine git commit hash', error);
	}
}

logger.info(`=============`);
logger.info(`Starting Cutie server: Version: ${version.version}; Git commit: #${gitCommit}`);
logger.info(`=============`);

// handlers for all kinds of error coditions
process.on('exit', (code) => {
	logger.info(`Exiting with code: ${code}; connections: ${connections.size}`);
	process.exit(code);
});
process.on('SIGINT', () => {
	logger.info(`Received SIGINT`);
	process.exit(1);
});
process.on('SIGTERM', () => {
	logger.info(`Received SIGTERM`);
});
process.on('uncaughtException', (err, origin) => {
	logger.info(`Caught exception: ${err}\nException origin: ${origin}`);
	// It is crucial to handle uncaught exceptions and potentially exit the process gracefully.
});
process.on('unhandledRejection', (reason, promise) => {
	logger.info(`caught an unhandled Rejection: ${reason}, ${promise}`);
});
process.on('warning', (warning) => {
	logger.info(`Process warning: ${warning.message}`);
});

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

type ManagedConnection = {
	id: string;
	pc: RTCPeerConnection;
	createdAt: Date;
};

const connections = new Map<string, ManagedConnection>();

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
			logger.info('Connection state changed', {
				state: pc.iceConnectionState,
				gathering: pc.iceGatheringState
			});

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
		logger.info('ICE connection state changed', {
			id: connectionId,
			state: pc.iceConnectionState,
			gathering: pc.iceGatheringState
		});
	};

	pc.onconnectionstatechange = () => {
		logger.info(`Server connection state changed: ${pc.connectionState}`);
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
				logger.warn('No succeeded ICE candidate pair yet', { connectionId });
				return;
			}

			const pair = selectedPair as CandidatePairStats;
			const remote = remoteCandidates.get(pair.remoteCandidateId ?? '');

			if (!remote) {
				logger.warn('Selected pair has no matching remote candidate', {
					connectionId,
					pair: pair.id
				});
				return;
			}

			const ip = remote.ip ?? remote.address ?? 'unknown';
			const port = remote.port ?? remote.portNumber ?? 'unknown';

			// logger.info(`Remote ICE Candidate selected: ${JSON.stringify(remote)}`);
			// "ip" is frequently "" as some kind of security measure
			logger.info('Remote ICE candidate selected', {
				connectionId,
				ip,
				port,
				foundation: remote.foundation
			});
		};

		// When the data channel opens, send a welcome message
		// (The welcome is not necessary for the protocol, but
		// shows up in the web GUI)
		channel.onopen = () => {
			logger.info('Connection established', {
				connectionId: connectionId ?? 'pending'
			});
			logRemoteAddress().catch((error) => {
				logger.warn('Failed to fetch remote ICE stats', { connectionId, error });
			});

			channel.send(
				JSON.stringify({
					type: 'welcome',
					message: 'RTC channel established with server',
					at: new Date().toISOString()
				})
			);
		};

		channel.onclose = () => {
			logger.info(`Connection closed: ${connectionId}`);
		};
		channel.onerror = () => {
			logger.info(`Connection error: ${connectionId}`);
		};

		// Simply send back any received message
		// (This is it! The heart of the server, right here)
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
			logger.info('Failed to add remote ICE candidate', { candidate, error: candidateError });
		}
	}
	try {
		// Signal that there are no more remote candidates.
		await pc.addIceCandidate(null);
	} catch (finalCandidateError) {
		logger.info('Failed to finalize remote ICE candidates', finalCandidateError);
	}

	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);

	connectionId = registerConnection(pc);

	logger.info('WebRTC answer ready', {
		connectionId,
		localCandidateCount: localCandidates.length,
		iceConnectionState: pc.iceConnectionState,
		iceGatheringState: pc.iceGatheringState
	});

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

	logger.info(`Deleting connection: ${managed.id}`);
	managed.pc.close();
	connections.delete(connectionId);

	return json({ closed: true });
};
