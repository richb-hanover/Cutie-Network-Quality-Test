import { execSync } from 'node:child_process';
import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';
import { version } from '../../package.json';

export const load: PageServerLoad = async () => {
	let gitCommit: string | null = null;

	if (dev) {
		try {
			gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
		} catch (error) {
			console.warn('Unable to determine git commit hash', error);
		}
	}

	return {
		version,
		gitCommit
	};
};
