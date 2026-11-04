import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[/\\](?:@codemirror|@lezer|@uiw)[/\\]/.test(id)) return 'editor';
          if (/[/\\](?:react|react-dom|scheduler)[/\\]/.test(id)) return 'react';
        },
      },
    },
  },
});
