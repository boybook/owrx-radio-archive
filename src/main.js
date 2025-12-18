/**
 * Radio Archive - Timeline Audio Player for OpenWebRX+
 * A Vue 3 application for browsing and playing recorded audio files
 */

// Import styles
import './styles/main.css'
import './styles/timeline.css'
import './styles/player.css'

// Import App component
import App from './App.vue'

// In dev mode, Vue is bundled by Vite, so we can import directly
// In production (IIFE build), Vue is external and comes from window.Vue
// We use dynamic import pattern to handle both cases
let createAppFn = null

// Check if we're in dev mode (Vite injects this)
const isDev = import.meta.env?.DEV ?? false

if (isDev) {
    // Development: import Vue directly (Vite bundles it)
    import('vue').then(Vue => {
        createAppFn = Vue.createApp
        console.log('[RadioArchive] Dev mode: Vue imported from bundle')
        startInit()
    })
} else {
    // Production: wait for global Vue
    console.log('[RadioArchive] Production mode: waiting for global Vue')
    startInit()
}

function startInit() {
    console.log('[RadioArchive] Script loaded')
    console.log('[RadioArchive] Current pathname:', location.pathname)

    // Only run on /files page (or root in dev mode)
    const isFilesPage = location.pathname.endsWith('/files') ||
                        location.pathname.endsWith('/files/') ||
                        (isDev && location.hostname === 'localhost' && location.pathname === '/')

    if (!isFilesPage) {
        console.log('[RadioArchive] Not on /files page, exiting')
    } else {
        console.log('[RadioArchive] On /files page, initializing...')
        init()
    }
}

function waitForVue(timeout = 5000) {
    console.log('[RadioArchive] Waiting for Vue...')

    return new Promise((resolve, reject) => {
        if (window.Vue) {
            console.log('[RadioArchive] Vue already available')
            return resolve(window.Vue)
        }

        const start = Date.now()
        const check = setInterval(() => {
            if (window.Vue) {
                clearInterval(check)
                console.log('[RadioArchive] Vue loaded after', Date.now() - start, 'ms')
                resolve(window.Vue)
            } else if (Date.now() - start > timeout) {
                clearInterval(check)
                console.error('[RadioArchive] Vue load timeout after', timeout, 'ms')
                reject(new Error('Vue not loaded'))
            }
        }, 50)
    })
}

function init() {
    if (document.readyState === 'loading') {
        console.log('[RadioArchive] DOM still loading, waiting for DOMContentLoaded...')
        document.addEventListener('DOMContentLoaded', initApp)
    } else {
        console.log('[RadioArchive] DOM already ready, calling initApp() directly')
        initApp()
    }
}

async function initApp() {
    try {
        // In production mode, we need to wait for Vue
        if (!isDev) {
            const Vue = await waitForVue()
            createAppFn = Vue.createApp
            console.log('[RadioArchive] Vue version:', Vue.version)
        }

        console.log('[RadioArchive] Initializing app...')

        // Find container
        const container = document.querySelector('.container')
        console.log('[RadioArchive] container =', container)

        if (!container) {
            console.error('[RadioArchive] .container not found')
            return
        }

        const h1 = container.querySelector('h1')
        const table = container.querySelector('table')
        console.log('[RadioArchive] h1 =', h1)
        console.log('[RadioArchive] table =', table)

        if (!h1 || !table) {
            console.error('[RadioArchive] h1 or table not found in container')
            return
        }

        // Create Vue mount point
        const appContainer = document.createElement('div')
        appContainer.id = 'radio-archive-app'
        h1.after(appContainer)
        console.log('[RadioArchive] App container inserted after h1')

        // Remove the original h1 title
        h1.remove()
        console.log('[RadioArchive] Removed h1 title')

        // Wrap original table
        const originalView = document.createElement('div')
        originalView.id = 'original-files-view'
        originalView.className = 'radio-archive-view'
        table.parentNode.insertBefore(originalView, table)
        originalView.appendChild(table)
        console.log('[RadioArchive] Original table wrapped')

        // Create and mount Vue app
        console.log('[RadioArchive] Mounting Vue app...')
        const app = createAppFn(App)
        app.mount('#radio-archive-app')
        console.log('[RadioArchive] Mounted successfully!')

    } catch (err) {
        console.error('[RadioArchive] Failed to initialize:', err)
        console.error('[RadioArchive] Error stack:', err.stack)
    }
}
