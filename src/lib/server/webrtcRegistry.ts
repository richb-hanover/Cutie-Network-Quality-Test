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
	disconnectedAt: Date | null; // when the peer first left 'connected' (disconnected or failed); it may recover
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
 * - 'closed': the connection is over. Log it (as clean if the client sent a DELETE,
 *   otherwise UNEXPECTED) and finalize it.
 * - 'disconnected' and 'failed': connectivity checks are not being answered, but the
 *   connection can come back (a hidden Safari tab went disconnected, then failed about
 *   45 s after being hidden, then came back to 'connected' when the tab woke). Log it and
 *   keep the connection registered. A connection that never returns is closed by the
 *   server timeout (reapExpiredConnections).
 * - 'connected' after either: log the recovery.
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
		// Already finalized (for example by the DELETE handler or the server timeout)
		logger.debug(`${tag}Connection ${id} state=${state} (already finalized)`);
		return;
	}

	const openDurationMs = managed.openedAt ? Date.now() - managed.openedAt.getTime() : null;
	const lastMessageAt = managed.lastMessageAt
		? formatLocalDateTime(managed.lastMessageAt.getTime())
		: 'never';

	if (state === 'closed') {
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

	if (state === 'disconnected' || state === 'failed') {
		managed.disconnectedAt ??= new Date();
		log(
			`${tag}Connection ${state === 'failed' ? 'failed (may still recover)' : 'disconnected (may recover)'}: ` +
				`id=${id} iceState=${pc.iceConnectionState} ` +
				`lastMessageAt=${lastMessageAt} openDurationMs=${openDurationMs}`
		);
		return;
	}

	if (state === 'connected' && managed.disconnectedAt) {
		const notConnectedMs = Date.now() - managed.disconnectedAt.getTime();
		managed.disconnectedAt = null;
		log(`${tag}Connection recovered: id=${id} after ${notConnectedMs}ms not connected`);
		return;
	}

	log(`${tag}Connection state changed: id: ${id} state: ${state}`);
}

/** Every connection is closed once it is this old, whatever state it is in. */
export const CONNECTION_MAX_AGE_MS = (2 * 60 + 10) * 60_000; // 2 h 10 min: a session stops itself at 2 h
/** The reason /api/stats shows for a connection closed by the server timeout. */
export const SERVER_TIMEOUT_REASON = 'Server timeout after 2h10m';
const REAPER_INTERVAL_MS = 60_000;

/**
 * reapExpiredConnections() - close and finalize every connection that is at least
 * CONNECTION_MAX_AGE_MS old. Earlier versions left sessions alive for days.
 * @param now - the current time
 * @param log - where info messages go
 * @returns the ids of the connections that were closed
 */
export function reapExpiredConnections(now: Date, log: (message: string) => void): string[] {
	const reaped: string[] = [];
	for (const managed of [...connections.values()]) {
		const ageMs = now.getTime() - managed.startedAt.getTime();
		if (ageMs < CONNECTION_MAX_AGE_MS) {
			continue;
		}
		// Finalize first so the timeout reason is what gets recorded: closing the peer sends a
		// 'closed' event that would otherwise be reported as an unexpected close.
		finalizeConnection(managed.id, SERVER_TIMEOUT_REASON, now);
		try {
			managed.pc.close();
		} catch (err) {
			logger.debug(`Closing timed-out connection ${managed.id} failed: ${err}`);
		}
		log(
			`Connection ${managed.id} closed by server timeout after ${Math.round(ageMs / 60_000)} minutes`
		);
		reaped.push(managed.id);
	}
	return reaped;
}

let reaperTimer: ReturnType<typeof setInterval> | null = null;

/** startConnectionReaper() - check for expired connections once a minute. Safe to call again. */
export function startConnectionReaper(log: (message: string) => void): void {
	if (reaperTimer) {
		return;
	}
	reaperTimer = setInterval(() => reapExpiredConnections(new Date(), log), REAPER_INTERVAL_MS);
	reaperTimer.unref?.(); // never keep the server process alive just for this timer
}
