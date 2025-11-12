import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

const isVitest = process.env.VITEST;

// Ensure the browser build sees the same log level configured for the server
if (!process.env.VITE_LOG_LEVEL && process.env.LOG_LEVEL) {
	process.env.VITE_LOG_LEVEL = process.env.LOG_LEVEL;
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: { allowedHosts: true },
	resolve: {
		conditions: isVitest ? ['browser'] : undefined
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/lib/server/**'],
		setupFiles: ['./vitest-setup-client.ts'],
		expect: { requireAssertions: true }
	}
});
