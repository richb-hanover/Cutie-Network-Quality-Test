// import type { RTCPeerConnection } from '@roamhq/wrtc';
import { getLogger } from '../logger';
import { formatLocalDateTime } from '../session-file';
const logger = getLogger('webrtcRegistry');

export type ManagedConnection = {
	id: string;
	pc: RTCPeerConnection;
	startedAt: Date;
	reason: string;
	deleteReceived: boolean; // true when DELETE request received for this connection
	openedAt: Date | null; // when the server's data channel opened
	lastMessageAt: Date | null; // when the last message was received
	disconnectedAt: Date | null; // set while the peer is 'disconnected' (it may still recover)
	clientIp: string;
};

export type ClosedConnection = {
	id: string;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
	reason: string;
	clientIp: string;
};

// Tracks active WebRTC connections keyed by connection id.
export const connections = new Map<string, ManagedConnection>();
export const oldConnections: ClosedConnection[] = [];

export function finalizeConnection(
	connectionId: string,
	reason: string,
	endedAt: Date = new Date()
): void {
	const managed = connections.get(connectionId);
	if (!managed) {
		return;
	}

	logger.info(`finalizing connection: ${connectionId}`);
	connections.delete(connectionId);

	const durationMs = Math.max(0, endedAt.getTime() - managed.startedAt.getTime());
	oldConnections.unshift({
		id: managed.id,
		startedAt: managed.startedAt,
		endedAt,
		durationMs,
		reason,
		clientIp: managed.clientIp
	});

	if (oldConnections.length > 10) {
		oldConnections.pop();
	}
}

/**
 * handleConnectionStateChange() - react to the peer connection's state changing.
 *
 * - 'failed' / 'closed': the connection is over. Log it (as clean if the client sent a
 *   DELETE, otherwise UNEXPECTED) and finalize it.
 * - 'disconnected': connectivity checks are failing, but the connection can recover (a
 *   hidden Safari tab came back twice). Log it and keep the connection registered.
 * - 'connected' after 'disconnected': log the recovery.
 * @param log - where info messages go (the caller's logger)
 */
export function handleConnectionStateChange(
	id: string,
	pc: { connectionState: string; iceConnectionState: string; iceGatheringState: string },
	tag: string,
	log: (message: string) => void
): void {
	const managed = connections.get(id); // get BEFORE finalizeConnection removes it
	const state = pc.connectionState;

	if (!managed) {
		// Already finalized (for example by the DELETE handler)
		logger.debug(`${tag}Connection ${id} state=${state} (already finalized)`);
		return;
	}

	const openDurationMs = managed.openedAt ? Date.now() - managed.openedAt.getTime() : null;
	const lastMessageAt = managed.lastMessageAt
		? formatLocalDateTime(managed.lastMessageAt.getTime())
		: 'never';

	if (state === 'closed' || state === 'failed') {
		if (managed.deleteReceived) {
			log(
				`${tag}Connection ${id} closed cleanly (DELETE received). openDurationMs=${openDurationMs}`
			);
		} else {
			log(
				`${tag}UNEXPECTED connection close: id=${id} ` +
					`state=${state} iceState=${pc.iceConnectionState} ` +
					`lastMessageAt=${lastMessageAt} openDurationMs=${openDurationMs}`
			);
		}
		finalizeConnection(
			id,
			managed.deleteReceived
				? 'Client DELETE'
				: `${pc.iceConnectionState} / ${pc.iceGatheringState}`
		);
		return;
	}

	if (state === 'disconnected') {
		managed.disconnectedAt ??= new Date();
		log(
			`${tag}Connection disconnected (may recover): id=${id} ` +
				`iceState=${pc.iceConnectionState} ` +
				`lastMessageAt=${lastMessageAt} openDurationMs=${openDurationMs}`
		);
		return;
	}

	if (state === 'connected' && managed.disconnectedAt) {
		const disconnectedForMs = Date.now() - managed.disconnectedAt.getTime();
		managed.disconnectedAt = null;
		log(`${tag}Connection recovered: id=${id} after ${disconnectedForMs}ms disconnected`);
		return;
	}

	log(`${tag}Connection state changed: id: ${id} state: ${state}`);
}
