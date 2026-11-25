import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples')) {
            return 'three-addons';
          }
          if (id.includes('node_modules/three')) {
            return 'three-core';
          }
          return undefined;
        },
      },
    },
  },
});
