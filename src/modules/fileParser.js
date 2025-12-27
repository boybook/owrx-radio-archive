/**
 * FileParser - Parse REC-YYMMDD-HHMMSS-FREQ.mp3 filenames
 */
import { SECONDS_PER_DAY } from './constants.js'
import { formatDateKey, timeOfDayFromDate, getDayOffset } from './dateUtils.js'

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
    const dateKey = formatDateKey(date)

    // hours/minutes/seconds use local timezone (for display)
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const seconds = date.getSeconds()

    // timeOfDay based on local timezone (for timeline positioning)
    const timeOfDay = timeOfDayFromDate(date)

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

/**
 * Parse duration string "M:SS" or "MM:SS" to seconds
 * @param {string} str - Duration string like "1:40" or "12:30"
 * @returns {number|null} Duration in seconds or null if invalid
 */
export function parseDurationString(str) {
    if (!str) return null
    const parts = str.trim().split(':')
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10)
        const seconds = parseInt(parts[1], 10)
        if (!isNaN(minutes) && !isNaN(seconds)) {
            return minutes * 60 + seconds
        }
    }
    return null
}

/**
 * Calculate duration from file size string (assuming 32kbps bitrate)
 * @param {string} sizeStr - Size string like "392kB" or "1.5MB"
 * @returns {number|null} Duration in seconds or null if invalid
 */
export function calculateDurationFromSize(sizeStr) {
    if (!sizeStr) return null
    const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(kB|MB|bytes?)/i)
    if (!match) return null

    let bytes = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    if (unit === 'kb') bytes *= 1024
    else if (unit === 'mb') bytes *= 1024 * 1024

    // 32kbps = 32000 bits/s = 4000 bytes/s
    const bytesPerSecond = 32000 / 8
    return bytes / bytesPerSecond
}

/**
 * Parse JSONL content into chunks array
 * @param {string} content - JSONL file content
 * @returns {Array} Array of chunk objects
 */
export function parseJsonlContent(content) {
    return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
}

/**
 * Convert JSONL chunks to activeSegments format
 * @param {Array} chunks - Array of chunk objects from JSONL
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipShort - Whether to skip short segments
 * @param {number} options.shortThresholdMs - Threshold for short segments (default 2048ms)
 * @param {number} options.proximityMs - Keep short segments within this range of long segments (default 5000ms)
 * @param {number} options.longThresholdMs - Threshold for "long" segments that attract nearby short ones (default 5000ms)
 * @param {Date} options.recordingStartDate - Recording start date for cross-day time calculation
 * @returns {Object} { segments: Array, realTimeRange: { start, end } | null, allSkipped: boolean }
 */
export function chunksToActiveSegments(chunks, options = {}) {
    const {
        skipShort = false,
        shortThresholdMs = 2048,
        proximityMs = 5000,
        longThresholdMs = 5000,
        recordingStartDate = null
    } = options

    if (!chunks?.length) return { segments: [], realTimeRange: null, allSkipped: false }

    // Filter short segments if enabled
    let filteredChunks
    if (skipShort) {
        // First, identify all valid (non-short) chunks
        const validChunks = chunks.filter(chunk => chunk.duration_ms > shortThresholdMs)

        if (validChunks.length === 0) {
            // All chunks are short
            return { segments: [], realTimeRange: null, allSkipped: true }
        }

        // Build time ranges only for LONG chunks (> longThresholdMs) - these attract nearby short segments
        const longChunks = chunks.filter(chunk => chunk.duration_ms > longThresholdMs)
        const attractRanges = longChunks.map(chunk => ({
            start: chunk.start_time_ms - proximityMs,
            end: chunk.start_time_ms + chunk.duration_ms + proximityMs
        }))

        // Keep chunks that are either valid OR within proximity of a long chunk
        filteredChunks = chunks.filter(chunk => {
            // Always keep valid (non-short) chunks
            if (chunk.duration_ms > shortThresholdMs) return true

            // Check if this short chunk is within proximity of any long chunk
            const chunkStart = chunk.start_time_ms
            const chunkEnd = chunk.start_time_ms + chunk.duration_ms

            return attractRanges.some(range =>
                chunkEnd > range.start && chunkStart < range.end
            )
        })
    } else {
        filteredChunks = chunks
    }

    // Check if all chunks were filtered out
    if (!filteredChunks.length) {
        return { segments: [], realTimeRange: null, allSkipped: true }
    }

    const segments = filteredChunks.map(chunk => {
        const utc = new Date(chunk.start_utc)
        // Calculate timeOfDay in local timezone (for timeline positioning)
        let timeOfDay = timeOfDayFromDate(utc, true)

        // Handle cross-day recordings: calculate day offset from recording start date
        if (recordingStartDate) {
            const dayOffset = getDayOffset(recordingStartDate, utc)

            // Add day offset to timeOfDay for cross-day chunks
            if (dayOffset > 0) {
                timeOfDay += dayOffset * SECONDS_PER_DAY
            }
        }

        const durationSec = chunk.duration_ms / 1000

        return {
            start: timeOfDay,
            end: timeOfDay + durationSec,
            audioStart: chunk.start_time_ms / 1000,
            audioEnd: (chunk.start_time_ms + chunk.duration_ms) / 1000
        }
    })

    // Calculate real time range (first chunk start to last chunk end)
    const firstSeg = segments[0]
    const lastSeg = segments[segments.length - 1]
    const realTimeRange = {
        start: firstSeg.start,
        end: lastSeg.end
    }

    return { segments, realTimeRange, allSkipped: false }
}

/**
 * Map audio playback time to timeline time
 * @param {number} audioTime - Current audio playback time in seconds
 * @param {Array} segments - Active segments array
 * @returns {number|null} Timeline time or null if not found
 */
export function audioTimeToTimelineTime(audioTime, segments) {
    if (!segments?.length) return null

    for (const seg of segments) {
        if (audioTime >= seg.audioStart && audioTime < seg.audioEnd) {
            return seg.start + (audioTime - seg.audioStart)
        }
    }

    // If past last segment, return last segment's end
    const last = segments[segments.length - 1]
    if (audioTime >= last.audioEnd) return last.end

    return null
}

export default {
    PATTERN,
    parseFilename,
    formatFreq,
    formatTime,
    formatDuration,
    parseDurationString,
    calculateDurationFromSize,
    parseJsonlContent,
    chunksToActiveSegments,
    audioTimeToTimelineTime
}
