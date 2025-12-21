import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@deltawatch/shared']
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/monitors': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/status': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/settings': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/proxy': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/preview-scenario': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/run-scenario-live': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/static': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/test-notification': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/data': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
    host: true // Expose to network
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /@deltawatch\/shared/]
    }
  }
})
