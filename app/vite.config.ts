import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/ngi-proxy': {
				target: 'https://wmts.ngi.be',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/ngi-proxy/, '')
			}
		}
	},
	build: {
		sourcemap: true,
		chunkSizeWarningLimit: 1200,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) return;
					if (id.includes('openseadragon')) return 'openseadragon';
					if (id.includes('maplibre-gl')) return 'maplibre';
					if (id.includes('@allmaps/')) return 'allmaps';
				}
			}
		}
	}
});
