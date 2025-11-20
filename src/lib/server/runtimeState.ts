// module scope = per server instance
export const serverStartTime = new Date();
export let webrtcConnections = 0;

export function incrementWebrtcConnections() {
	webrtcConnections += 1;
}
