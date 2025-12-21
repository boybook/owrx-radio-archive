/**
 * URL参数同步工具
 */

export function getUrlParams() {
    return new URLSearchParams(window.location.search)
}

export function getUrlParam(key) {
    return getUrlParams().get(key)
}

export function updateUrlParam(key, value) {
    const params = getUrlParams()
    if (value !== null && value !== undefined) {
        params.set(key, String(value))
    } else {
        params.delete(key)
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState({}, '', newUrl)
}
