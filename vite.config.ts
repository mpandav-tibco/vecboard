import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load .env / .env.local without the VITE_ prefix filter so server-side
  // proxy targets (which are never exposed to the browser) can use plain names.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/tests/setup.ts'],
    },
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api/weaviate': {
          target: env.WEAVIATE_URL || 'http://localhost:18080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/weaviate/, ''),
        },
        '/api/qdrant': {
          target: env.QDRANT_URL || 'http://localhost:6333',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/qdrant/, ''),
        },
        '/api/chroma': {
          target: env.CHROMA_URL || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/chroma/, ''),
        },
        '/api/pgvector': {
          target: env.PGVECTOR_URL || 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/pgvector/, ''),
        },
        '/api/activespaces': {
          target: env.AS_BRIDGE_URL || 'http://localhost:9090',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/activespaces/, ''),
        },
        '/api/ollama': {
          target: env.OLLAMA_URL || 'http://localhost:11434',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
        },
      },
    },
  }
})
