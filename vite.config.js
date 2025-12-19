import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { resolve } from 'path'

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    cssInjectedByJsPlugin(),
    // Custom plugin to serve index.html at /files path
    {
      name: 'files-route',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Serve index.html for root, /files and /files/ paths
          if (req.url === '/' || req.url === '/files' || req.url === '/files/') {
            req.url = '/index.html'
          }
          next()
        })
      }
    }
  ],
  server: {
    open: '/files'
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.js'),
      name: 'RadioArchive',
      fileName: () => 'radio-archive.js',
      formats: ['iife']
    },
    rollupOptions: {
      // Only external vue in build mode (production)
      // In dev mode, Vite bundles vue normally
      external: command === 'build' ? ['vue'] : [],
      output: {
        globals: {
          vue: 'Vue'
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'radio-archive.css'
          }
          return assetInfo.name
        }
      }
    },
    cssCodeSplit: false,
    minify: 'esbuild'
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development')
  }
}))
