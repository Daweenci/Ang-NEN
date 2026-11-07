import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Proxy API and WebSocket to the Express server so the browser sees a single
  // origin in development too (needed for the SameSite=Strict session cookie)
  server: {
    proxy: {
      '/login': 'http://localhost:4000',
      '/register': 'http://localhost:4000',
      '/logout': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
