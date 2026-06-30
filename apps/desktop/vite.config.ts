import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 17633,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 17634,
    strictPort: true,
  },
})
