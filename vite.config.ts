import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The Firebase chunk (online play only, loaded on demand) is ~540 kB.
  build: { chunkSizeWarningLimit: 600 },
})
