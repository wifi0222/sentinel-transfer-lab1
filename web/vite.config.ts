import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'https://localhost:8443', secure: false },
      '/ws': { target: 'wss://localhost:8443', ws: true, secure: false }
    }
  },
  build: { sourcemap: false, target: 'es2022' }
});

