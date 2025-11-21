import type { RTCPeerConnection } from '@roamhq/wrtc';

export type ManagedConnection = {
	id: string;
	pc: RTCPeerConnection;
	createdAt: Date;
};

// Tracks active WebRTC connections keyed by connection id.
export const connections = new Map<string, ManagedConnection>();
