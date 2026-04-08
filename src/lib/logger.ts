import { Logger } from 'tslog';

const DEFAULT_LOG_LEVEL = 3;

function getLogLevel(): number {
	const clientValue =
		typeof import.meta !== 'undefined' && import.meta.env?.VITE_LOG_LEVEL
			? parseInt(import.meta.env.VITE_LOG_LEVEL, 10)
			: undefined;
	if (clientValue !== undefined && !Number.isNaN(clientValue)) {
		return clientValue;
	}

	const serverValue =
		typeof process !== 'undefined' && process.env?.LOG_LEVEL
			? parseInt(process.env.LOG_LEVEL, 10)
			: undefined;
	if (serverValue !== undefined && !Number.isNaN(serverValue)) {
		return serverValue;
	}

	return DEFAULT_LOG_LEVEL;
}

// Usage: LOG_LEVEL=# npm run dev ...
const rootLogger = new Logger({
	name: 'root',
	// 0: silly, 1: trace, 2: debug, 3: info, 4: warn, 5: error, 6: fatal
	minLevel: getLogLevel(),
	hideLogPositionForProduction: true,
	prettyLogTimeZone: 'local',
	prettyLogTemplate:
		'{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t[{{name}}:{{logLevelName}}] ',
	stylePrettyLogs: false
});

export function getLogger(name: string) {
	return rootLogger.getSubLogger({ name });
}

/**
 * Returns a short client identifier from the last two octets of an IPv4 address,
 * formatted as "(XXYY) " for use as a log message prefix.
 * e.g. 12.34.56.78 → "(5678) ", 127.0.0.1 → "(01) "
 */
export function ipTag(ip: string): string {
	const parts = ip.split('.');
	if (parts.length === 4) {
		return `(${parts[2]}${parts[3]}) `;
	}
	return '';
}
