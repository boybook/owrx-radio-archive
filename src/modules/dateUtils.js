/**
 * DateUtils - Unified date/time calculation utilities
 */
import { SECONDS_PER_DAY, MILLISECONDS_PER_DAY } from './constants.js'

/**
 * Create a midnight Date object (strip time part)
 * @param {Date} date - Source date
 * @returns {Date} Date at 00:00:00 local time
 */
export function getLocalMidnightDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Format date as YYYY-MM-DD string (local timezone)
 * @param {Date} date - Date to format
 * @returns {string} Formatted date key
 */
export function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Calculate day offset between two dates
 * @param {Date} fromDate - Start date
 * @param {Date} toDate - End date
 * @returns {number} Number of days (positive if toDate is later)
 */
export function getDayOffset(fromDate, toDate) {
    const from = getLocalMidnightDate(fromDate)
    const to = getLocalMidnightDate(toDate)
    return Math.round((to - from) / MILLISECONDS_PER_DAY)
}

/**
 * Convert Date to time-of-day in seconds (local timezone)
 * @param {Date} date - Date object
 * @param {boolean} includeMs - Include milliseconds
 * @returns {number} Seconds since midnight
 */
export function timeOfDayFromDate(date, includeMs = false) {
    let seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
    if (includeMs) {
        seconds += date.getMilliseconds() / 1000
    }
    return seconds
}

/**
 * Clamp time to day boundary [0, SECONDS_PER_DAY]
 * @param {number} time - Time in seconds
 * @returns {number} Clamped time
 */
export function clampTimeToDay(time) {
    return Math.max(0, Math.min(time, SECONDS_PER_DAY))
}

/**
 * Check if time range is completely outside day boundary
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds
 * @returns {boolean} True if completely outside
 */
export function isTimeOutOfDay(start, end) {
    return end <= 0 || start >= SECONDS_PER_DAY
}
