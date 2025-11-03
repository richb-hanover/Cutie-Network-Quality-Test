// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { getLogger } from '$lib/logger';

const logger = getLogger('http');

export const handle: Handle = async ({ event, resolve }) => {
	const clientAddress = event.getClientAddress();
	const method = event.request.method;
	const path = event.url.pathname;
	logger.info(`Received  http ${method} from ${clientAddress} for ${path}`);

	const response = await resolve(event);

	const status = response.status;
	logger.info(`Completed http ${method} from ${clientAddress} for ${path} status ${status}`);

	return response;
};
