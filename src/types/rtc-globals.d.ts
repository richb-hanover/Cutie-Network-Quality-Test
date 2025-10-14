type RtcConnectionResult = {
	peerConnection: RTCPeerConnection;
	dataChannel: RTCDataChannel;
	connectionId: string;
	close: () => Promise<void>;
};

type RtcClientModule = {
	createServerConnection: (options?: {
		rtcConfig?: RTCConfiguration;
		signalUrl?: string;
		onMessage?: (event: MessageEvent) => void;
		onOpen?: () => void;
		onError?: (error: unknown) => void;
	}) => Promise<RtcConnectionResult>;
};

type RtcStatsSummary = {
	timestamp: number;
	bytesSent: number;
	bytesReceived: number;
	packetsSent: number;
	packetsReceived: number;
	messagesSent: number;
	messagesReceived: number;
	currentRoundTripTime: number | null;
};

type RtcStatsModule = {
	startStatsReporter: (
		peer: RTCPeerConnection,
		callback: (summary: RtcStatsSummary, report: RTCStatsReport) => void,
		intervalMs?: number
	) => () => void;
};

declare global {
	interface Window {
		RtcClient?: RtcClientModule;
		RtcStats?: RtcStatsModule;
	}
}

export {};
