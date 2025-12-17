import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.js'),
      name: 'RadioArchive',
      fileName: () => 'radio-archive.js',
      formats: ['iife']
    },
    rollupOptions: {
      external: ['vue'],
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
    'process.env.NODE_ENV': JSON.stringify('production')
  }
})
