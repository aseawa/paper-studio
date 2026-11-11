import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.PAPER_STUDIO_BASE || '/',
  plugins: [react()],
});
