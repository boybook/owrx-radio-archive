/**
 * AudioSourceManager - 音频源管理器
 * 根据浏览器环境选择最佳的音频加载策略
 *
 * Chrome/Firefox: 直接使用原始 URL（这些浏览器在服务器不支持 Range 请求时也能 seek）
 * 其他浏览器 (Safari, Edge 等): 使用 Blob URL（先下载完整文件再播放）
 */

// Blob URL 缓存，避免重复下载
const blobUrlCache = new Map()

// 加载状态回调
let loadingCallback = null

/**
 * 检测浏览器是否原生支持无 Range 请求的 seek
 * 只有明确识别为 Chrome 或 Firefox 时返回 true
 */
function supportsSeekWithoutRange() {
    const ua = navigator.userAgent
    // Chrome (排除 Edge，因为 Edge UA 也包含 Chrome)
    const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua)
    // Firefox
    const isFirefox = /Firefox\//.test(ua)
    return isChrome || isFirefox
}

/**
 * 获取可播放的音频 URL
 * @param {string} originalUrl - 原始音频 URL
 * @param {Object} options - 选项
 * @param {boolean} options.bustCache - 是否添加缓存破坏参数（用于正在录制的最新文件）
 * @returns {Promise<string>} - 可播放的 URL（直接 URL 或 Blob URL）
 */
export async function getPlayableUrl(originalUrl, options = {}) {
    const url = options.bustCache ? `${originalUrl}?t=${Date.now()}` : originalUrl

    // Chrome/Firefox: 直接返回原 URL
    if (supportsSeekWithoutRange()) {
        return url
    }

    // 其他浏览器: 使用 Blob URL
    // 检查缓存（注意：bustCache 的文件不使用缓存）
    if (!options.bustCache) {
        const cached = blobUrlCache.get(originalUrl)
        if (cached) {
            return cached
        }
    }

    // 下载并创建 Blob URL
    loadingCallback?.(true)
    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`)
        }
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)

        // 缓存（bustCache 的文件也缓存，因为下次可能不再是最新的）
        // 如果已有旧的缓存，先释放
        const oldBlobUrl = blobUrlCache.get(originalUrl)
        if (oldBlobUrl) {
            URL.revokeObjectURL(oldBlobUrl)
        }
        blobUrlCache.set(originalUrl, blobUrl)

        return blobUrl
    } finally {
        loadingCallback?.(false)
    }
}

/**
 * 设置加载状态回调
 * @param {Function} callback - 回调函数，接收 boolean 参数表示是否正在加载
 */
export function onLoadingChange(callback) {
    loadingCallback = callback
}

/**
 * 释放指定 URL 的 Blob 缓存
 * @param {string} originalUrl - 原始音频 URL
 */
export function revokeBlobUrl(originalUrl) {
    const blobUrl = blobUrlCache.get(originalUrl)
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        blobUrlCache.delete(originalUrl)
    }
}

/**
 * 清理所有 Blob 缓存
 */
export function revokeAllBlobUrls() {
    blobUrlCache.forEach(blobUrl => URL.revokeObjectURL(blobUrl))
    blobUrlCache.clear()
}

/**
 * 检查当前是否使用 Blob 模式
 * @returns {boolean}
 */
export function usesBlobMode() {
    return !supportsSeekWithoutRange()
}

/**
 * 获取缓存大小（用于调试）
 * @returns {number}
 */
export function getCacheSize() {
    return blobUrlCache.size
}
