// module scope = per server instance
export const serverStartTime = new Date();
export let webrtcConnections = 0;
export let numberVisitors = 0;

export function incrementWebrtcConnections() {
	webrtcConnections += 1;
}

export function incrementVisitors() {
	numberVisitors += 1;
}
