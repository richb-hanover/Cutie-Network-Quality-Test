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
