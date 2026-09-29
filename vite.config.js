import { defineConfig } from 'vite';

// Tauri expects a fixed port and works best with these settings:
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(async () => ({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  // Tauri uses a fixed port and fails if it is occupied.
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  test: {
    environment: 'node',
    include: ['tools/**/*.test.js', 'ui/**/*.test.js'],
    watch: false,
  },
}));
