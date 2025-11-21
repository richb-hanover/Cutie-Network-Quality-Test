import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverStartTime, webrtcConnections } from '$lib/server/runtimeState';
import { connections } from '$lib/server/webrtcRegistry';

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

	return json({
		currentConnections: connections.size,
		totalConnections: webrtcConnections,
		serverStartTime: serverStartTime.toLocaleString(),
		currentTime: now.toLocaleString(),
		runningTime: formatDuration(elapsedMs),
		connectionIds: Array.from(connections.keys())
	});
};
