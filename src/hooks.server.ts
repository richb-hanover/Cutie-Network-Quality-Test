// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { getLogger } from '$lib/logger';

const logger = getLogger('http');

export const handle: Handle = async ({ event, resolve }) => {
	const clientAddress = event.getClientAddress();

	logger.info(`Received ${event.request.method} from ${clientAddress} for ${event.url.pathname}`);

	const response = await resolve(event);

	// logger.info('Completed request', {
	// 	method: event.request.method,
	// 	path: event.url.pathname,
	// 	status: response.status
	// });

	return response;
};
