import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Recharts is ~275 kB and was being bundled into DashboardScreen,
          // making the first screen every user loads 398 kB. Splitting the
          // heavy third-party libraries into their own chunks lets the browser
          // cache them across deploys (they change far less often than app
          // code) and stops one screen's dependency from inflating its bundle.
          manualChunks: {
            // react/jsx-runtime must be listed explicitly: the React plugin
            // compiles JSX to jsx-runtime calls, so listing only 'react'
            // produced an empty chunk.
            'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
            'vendor-charts': ['recharts'],
            'vendor-supabase': ['@supabase/supabase-js'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
