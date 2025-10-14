declare module '@roamhq/wrtc' {
	const RTCPeerConnection: typeof globalThis.RTCPeerConnection;
	const RTCSessionDescription: typeof globalThis.RTCSessionDescription;
	const RTCIceCandidate: typeof globalThis.RTCIceCandidate;
	const MediaStream: typeof globalThis.MediaStream;
	const mediaDevices: MediaDevices;

	export {
		RTCPeerConnection,
		RTCSessionDescription,
		RTCIceCandidate,
		MediaStream,
		mediaDevices
	};

	const _default: {
		RTCPeerConnection: typeof globalThis.RTCPeerConnection;
		RTCSessionDescription: typeof globalThis.RTCSessionDescription;
		RTCIceCandidate: typeof globalThis.RTCIceCandidate;
		MediaStream: typeof globalThis.MediaStream;
		mediaDevices: MediaDevices;
	};

	export default _default;
}
