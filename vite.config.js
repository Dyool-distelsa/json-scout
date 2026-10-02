import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  } catch {
    return {};
  }
};

const git = (args) => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

/**
 * What the status bar shows, so it is always clear which build is running.
 * The app's real version is the one in tauri.conf.json (it names the installer);
 * package.json is the fallback. Git failures degrade to "unknown", never an error.
 */
function buildInfo() {
  const version = readJson('./src-tauri/tauri.conf.json').version || readJson('./package.json').version || 'dev';
  const full = git('rev-parse HEAD');
  const dirty = full !== '' && git('status --porcelain') !== '';
  return {
    version,
    commit: full ? `${git('rev-parse --short HEAD') || full.slice(0, 7)}${dirty ? '-dirty' : ''}` : 'unknown',
    commitFull: full ? `${full}${dirty ? '-dirty' : ''}` : 'unknown',
    date: new Date().toISOString(),
  };
}

function buildDefines() {
  const build = buildInfo();
  return {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_COMMIT_FULL__: JSON.stringify(build.commitFull),
    __APP_BUILD_DATE__: JSON.stringify(build.date),
  };
}

// Tauri expects a fixed port and works best with these settings:
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(async () => ({
  // Build constants for the status bar's version tag (see src/ui/buildTag.js).
  define: buildDefines(),
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
