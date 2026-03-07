// import type { RTCPeerConnection } from '@roamhq/wrtc';
import { getLogger } from '../logger';
const logger = getLogger('webrtcRegistry');

export type ManagedConnection = {
	id: string;
	pc: RTCPeerConnection;
	startedAt: Date;
	reason: string;
	deleteReceived: boolean; // true when DELETE request received for this connection
	openedAt: Date | null; // when the server's data channel opened
	lastMessageAt: Date | null; // when the last message was received
};

export type ClosedConnection = {
	id: string;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
	reason: string;
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
		reason
	});

	if (oldConnections.length > 10) {
		oldConnections.pop();
	}
}
