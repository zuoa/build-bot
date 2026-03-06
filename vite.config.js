import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'src/main/index.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['keytar', /\.node$/]
                        }
                    }
                }
            },
            preload: {
                input: 'src/main/preload.ts'
            }
        })
    ],
    optimizeDeps: {
        exclude: ['keytar']
    },
    clearScreen: false
});
