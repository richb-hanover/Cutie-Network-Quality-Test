import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import wrtc from '@roamhq/wrtc';

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

	const pc = new RTCPeerConnection({
		iceServers: [
			{
				urls: 'stun:stun.l.google.com:19302'
			}
		]
	} as RTCConfiguration);

	pc.oniceconnectionstatechange = () => {
		console.info('Server ICE connection state changed', {
			state: pc.iceConnectionState,
			gathering: pc.iceGatheringState
		});
	};

	pc.onconnectionstatechange = () => {
		console.info('Server connection state changed', {
			state: pc.connectionState
		});
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
				localCandidates.push(normalised);
			}
		}
	};

	pc.onicecandidateerror = (_event: unknown) => {
		// console.error('Server ICE candidate error', event);
	};

	pc.ondatachannel = (event) => {
		const channel = event.channel;

		// Send a (wholly unnecessary) welcome message

		channel.onopen = () => {
			console.log(`Connection established`);

			channel.send(
				JSON.stringify({
					type: 'welcome',
					message: 'RTC channel established with server',
					at: new Date().toISOString()
				})
			);
		};

		// Simply send back any received message
		// (This is the heart of the server, right here)
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
			console.warn('Failed to add remote ICE candidate', { candidate, error: candidateError });
		}
	}
	try {
		// Signal that there are no more remote candidates.
		await pc.addIceCandidate(null);
	} catch (finalCandidateError) {
		console.warn('Failed to finalize remote ICE candidates', finalCandidateError);
	}

	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);

	const connectionId = registerConnection(pc);

	console.info('WebRTC answer ready', {
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

	managed.pc.close();
	connections.delete(connectionId);

	return json({ closed: true });
};
