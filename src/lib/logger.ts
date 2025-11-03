import { Logger } from 'tslog';

// Usage: LOG_LEVEL=# npm run dev ...
const rootLogger = new Logger({
	name: 'root',
	// 0: silly, 1: trace, 2: debug, 3: info, 4: warn, 5: error, 6: fatal
	minLevel: parseInt(process.env.LOG_LEVEL || '3'),
	hideLogPositionForProduction: true,
	prettyLogTimeZone: 'local',
	prettyLogTemplate:
		'{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t[{{name}}:{{logLevelName}}] ',
	stylePrettyLogs: false
});

export function getLogger(name: string) {
	return rootLogger.getSubLogger({ name });
}
