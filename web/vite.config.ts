import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/v1': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' ws://localhost:* wss://localhost:* https://fonts.googleapis.com https://fonts.gstatic.com;"
    }
  },
  build: {
    // Enable minification and optimization
    minify: 'esbuild',
    // Generate source maps for production debugging
    sourcemap: false,
    // Chunk size warning limit
    chunkSizeWarningLimit: 500,
    // Rollup options for chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting strategy using function format
        manualChunks(id) {
          // React core - split React and ReactDOM
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          // React Router - separate chunk for routing
          if (id.includes('node_modules/react-router-dom/')) {
            return 'router';
          }
          // React Query - separate chunk for data fetching
          if (id.includes('node_modules/@tanstack/react-query/')) {
            return 'query';
          }
          // Lucide icons - separate chunk for icons
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
          // Utility libraries
          if (id.includes('node_modules/clsx/')) {
            return 'utils';
          }
        },
      },
    },
    // Target modern browsers for better optimization
    target: 'es2022',
    // CSS code splitting
    cssCodeSplit: true,
    // Enable CSS minification
    cssMinify: true,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'lucide-react',
      'clsx',
    ],
    // Force pre-bundling even in dev
    force: false,
  },
  // Enable esbuild for faster builds
  esbuild: {
    // Remove console.log in production
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    // Enable legal comments removal
    legalComments: 'none',
  },
})