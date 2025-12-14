import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/api|/monitors|/status|/test-selector|/settings': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
    host: true // Expose to network
  }
})
