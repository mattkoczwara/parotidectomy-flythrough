import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2023' },
  server: { port: 5174, strictPort: true },
});
