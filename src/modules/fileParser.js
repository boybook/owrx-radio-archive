/**
 * FileParser - Parse REC-YYMMDD-HHMMSS-FREQ.mp3 filenames
 */

// Pattern: REC-251214-100246-145280.mp3
const PATTERN = /^REC-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d+)\.mp3$/i

/**
 * Parse a recording filename
 * @param {string} filename - The filename to parse
 * @returns {object|null} Parsed recording data or null if invalid
 */
export function parseFilename(filename) {
    const match = filename.match(PATTERN)
    if (!match) return null

    const [, yy, mm, dd, hh, min, ss, freq] = match

    // Filename time is in UTC
    const utcYear = 2000 + parseInt(yy, 10)
    const utcMonth = parseInt(mm, 10) - 1
    const utcDay = parseInt(dd, 10)
    const utcHours = parseInt(hh, 10)
    const utcMinutes = parseInt(min, 10)
    const utcSeconds = parseInt(ss, 10)
    const frequency = parseInt(freq, 10)

    // Create UTC Date object
    const date = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHours, utcMinutes, utcSeconds))

    // dateKey based on local timezone (for date selector)
    const localYear = date.getFullYear()
    const localMonth = date.getMonth() + 1
    const localDay = date.getDate()
    const dateKey = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}`

    // hours/minutes/seconds use local timezone (for display)
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const seconds = date.getSeconds()

    // timeOfDay based on local timezone (for timeline positioning)
    const timeOfDay = hours * 3600 + minutes * 60 + seconds

    return {
        filename,
        date,
        dateKey,
        hours,
        minutes,
        seconds,
        frequency,
        freqMHz: frequency / 1000,
        timeOfDay,
        href: `files/${filename}`,
        audioDuration: null  // Initialize for Vue reactivity
    }
}

/**
 * Format frequency in Hz to MHz string
 * @param {number} freqHz - Frequency in Hz
 * @returns {string} Formatted string like "145.700 MHz"
 */
export function formatFreq(freqHz) {
    const mhz = freqHz / 1000
    return mhz.toFixed(3) + ' MHz'
}

/**
 * Format a Date object to time string
 * @param {Date} date - Date object
 * @returns {string} Formatted time string
 */
export function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })
}

/**
 * Format duration in seconds to MM:SS string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted string like "3:45"
 */
export function formatDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return '--:--'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}

export default {
    PATTERN,
    parseFilename,
    formatFreq,
    formatTime,
    formatDuration
}
