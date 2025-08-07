import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  build: {
    target: 'es2015',
    minify: 'esbuild',
    rollupOptions: {
      external: ['@rollup/rollup-win32-x64-msvc', '@rollup/rollup-linux-x64-gnu'],
      output: {
        manualChunks: undefined
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
}) 