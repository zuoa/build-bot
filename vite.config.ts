import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  resolve: {
    // Prefer source TS over checked-in JS artifacts under src/.
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json']
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          resolve: {
            extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json']
          },
          build: {
            rollupOptions: {
              external: ['keytar', /\.node$/]
            }
          }
        }
      },
      preload: {
        input: 'src/main/preload.ts',
        vite: {
          resolve: {
            extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json']
          }
        }
      }
    })
  ],
  optimizeDeps: {
    exclude: ['keytar']
  },
  clearScreen: false
});
