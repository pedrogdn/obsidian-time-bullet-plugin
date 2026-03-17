import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'test-support/obsidian.ts'),
		},
		extensions: ['.ts', '.mts', '.js', '.mjs', '.json'],
	},
	test: {
		environment: 'jsdom',
	},
});
