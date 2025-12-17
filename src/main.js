/**
 * Radio Archive - Timeline Audio Player for OpenWebRX+
 * A Vue 3 application for browsing and playing recorded audio files
 */

// Import styles
import './styles/main.css'
import './styles/timeline.css'
import './styles/player.css'

// Import Vue and App
import App from './App.vue'

console.log('[RadioArchive] Script loaded')
console.log('[RadioArchive] Current pathname:', location.pathname)

// Only run on /files page
if (!location.pathname.endsWith('/files') && !location.pathname.endsWith('/files/')) {
    console.log('[RadioArchive] Not on /files page, exiting')
} else {
    console.log('[RadioArchive] On /files page, initializing...')
    init()
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
        const Vue = await waitForVue()
        console.log('[RadioArchive] Vue ready, creating app...')
        console.log('[RadioArchive] Vue version:', Vue.version)

        const { createApp } = Vue

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
        const app = createApp(App)
        app.mount('#radio-archive-app')
        console.log('[RadioArchive] Mounted successfully!')

    } catch (err) {
        console.error('[RadioArchive] Failed to initialize:', err)
        console.error('[RadioArchive] Error stack:', err.stack)
    }
}
