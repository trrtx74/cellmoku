import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/cellmoku/', // for github pages
  build: {
    outDir: 'docs',
  },
  // The agent worker imports onnxruntime-web (ESM). Vite's default 'iife' worker
  // format cannot code-split it; 'es' keeps the worker's module graph intact and
  // separate from the app bundle. Module workers are fine for our target browsers.
  worker: {
    format: 'es',
  },
})
