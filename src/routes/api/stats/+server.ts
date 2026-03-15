import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverStartTime, webrtcConnections, numberVisitors } from '$lib/server/runtimeState';
import { connections, oldConnections } from '$lib/server/webrtcRegistry';
import { formatLocalDateTime } from '$lib/session-file';

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

export const GET: RequestHandler = () => {
	const now = new Date();
	const elapsedMs = now.getTime() - serverStartTime.getTime();
	const connectionDetails = Array.from(connections.values()).map((connection) => {
		const durationMs = now.getTime() - connection.startedAt.getTime();
		return {
			connectionId: connection.id,
			startTime: formatLocalDateTime(connection.startedAt.getTime()) + ' / ' + formatDuration(durationMs),
			reason: connection.reason
		};
	});
	const recentConnectionDetails = oldConnections.map((connection) => ({
		connectionId: connection.id,
		startTime: formatLocalDateTime(connection.startedAt.getTime()) + ' / ' + formatDuration(connection.durationMs),
		reason: connection.reason
	}));

	return json({
		serverStartTime: formatLocalDateTime(serverStartTime.getTime()),
		currentTime: formatLocalDateTime(now.getTime()),
		runningTime: formatDuration(elapsedMs),
		totalVisitors: numberVisitors,
		currentConnections: connections.size,
		totalConnections: webrtcConnections,
		// connectionIds: Array.from(connections.keys()),
		connections: connectionDetails,
		oldConnections: recentConnectionDetails
	});
};
