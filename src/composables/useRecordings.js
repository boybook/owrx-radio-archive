/**
 * useRecordings - Recording data management composable
 */
import { ref, reactive, computed } from 'vue'
import {
    parseFilename,
    parseDurationString,
    calculateDurationFromSize,
    parseJsonlContent,
    chunksToActiveSegments
} from '../modules/fileParser.js'

export function useRecordings() {
    // State
    const recordings = ref([])
    const selectedDate = ref(null)
    const selectedFreq = ref(null)
    // analysisCache preserved for future timestamp mapping feature
    const analysisCache = reactive(new Map())

    // Constants
    const SECONDS_PER_DAY = 86400

    // Computed
    const availableDates = computed(() => {
        const dates = [...new Set(recordings.value.map(r => r.dateKey))]
        return dates.sort()
    })

    const availableFreqs = computed(() => {
        const freqs = [...new Set(recordings.value.map(r => r.frequency))]
        return freqs.sort((a, b) => a - b)
    })

    const freqStats = computed(() => {
        if (!selectedDate.value) return {}
        const stats = {}
        recordings.value
            .filter(r => r.dateKey === selectedDate.value)
            .forEach(r => {
                stats[r.frequency] = (stats[r.frequency] || 0) + 1
            })
        return stats
    })

    const filteredRecordings = computed(() => {
        return recordings.value
            .filter(r => {
                if (selectedDate.value && r.dateKey !== selectedDate.value) return false
                if (selectedFreq.value && r.frequency !== selectedFreq.value) return false
                return true
            })
            .sort((a, b) => a.date - b.date)
    })

    // Cross-day recordings (from previous day extending into current day)
    const crossDayRecordings = computed(() => {
        if (!selectedDate.value) return []

        // Calculate previous day's dateKey
        const currentDate = new Date(selectedDate.value + 'T00:00:00')
        const prevDate = new Date(currentDate)
        prevDate.setDate(prevDate.getDate() - 1)
        const prevDateKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`

        return recordings.value
            .filter(r => {
                if (r.dateKey !== prevDateKey) return false
                if (selectedFreq.value && r.frequency !== selectedFreq.value) return false

                const duration = r.audioDuration && isFinite(r.audioDuration) ? r.audioDuration : 0
                if (duration <= 0) return false
                return r.timeOfDay + duration > SECONDS_PER_DAY
            })
            .map(r => {
                const offsetTime = r.timeOfDay - SECONDS_PER_DAY
                return {
                    ...r,
                    timeOfDay: offsetTime,
                    isCrossDay: true
                }
            })
    })

    // Timeline recordings (including cross-day)
    const timelineRecordings = computed(() => {
        return [...crossDayRecordings.value, ...filteredRecordings.value]
    })

    // Methods
    function parseFilesFromDOM() {
        console.log('[RadioArchive] parseFilesFromDOM called')

        const fileTiles = document.querySelectorAll('.file-tile')
        console.log('[RadioArchive] Found .file-tile elements:', fileTiles.length)

        const fileLinks = document.querySelectorAll('.file-tile a[href^="files/"]')
        console.log('[RadioArchive] Found file links:', fileLinks.length)

        const files = []
        fileLinks.forEach(link => {
            const href = link.getAttribute('href')
            const filename = href.replace('files/', '')

            // Only process mp3 files
            if (!filename.toLowerCase().endsWith('.mp3')) {
                return
            }

            console.log('[RadioArchive] Processing file:', filename)

            const parsed = parseFilename(filename)
            if (parsed) {
                // Try to get duration from DOM
                const durationEl = link.querySelector('.file-duration')
                if (durationEl) {
                    const duration = parseDurationString(durationEl.textContent)
                    if (duration !== null) {
                        parsed.audioDuration = duration
                        console.log('[RadioArchive] Duration from DOM:', duration)
                    }
                }

                // If no duration, try to calculate from file size
                if (parsed.audioDuration === null) {
                    const sizeEl = link.querySelector('.file-size')
                    if (sizeEl) {
                        const duration = calculateDurationFromSize(sizeEl.textContent)
                        if (duration !== null) {
                            parsed.audioDuration = duration
                            console.log('[RadioArchive] Duration from size:', duration)
                        }
                    }
                }

                console.log('[RadioArchive] Parsed:', parsed)
                files.push(parsed)
            } else {
                console.log('[RadioArchive] Could not parse:', filename)
            }
        })

        recordings.value = files
        console.log('[RadioArchive] Total recordings:', files.length)

        // Set initial selection
        if (availableDates.value.length > 0) {
            selectedDate.value = availableDates.value[availableDates.value.length - 1]
        }
        if (availableFreqs.value.length > 0) {
            selectedFreq.value = availableFreqs.value[0]
        }

        console.log('[RadioArchive] Selected date:', selectedDate.value)
        console.log('[RadioArchive] Selected freq:', selectedFreq.value)
    }

    function selectDate(dateKey) {
        selectedDate.value = dateKey
    }

    function selectFreq(freq) {
        selectedFreq.value = freq
    }

    function prevDate() {
        const idx = availableDates.value.indexOf(selectedDate.value)
        if (idx > 0) {
            selectDate(availableDates.value[idx - 1])
        }
    }

    function nextDate() {
        const idx = availableDates.value.indexOf(selectedDate.value)
        if (idx < availableDates.value.length - 1) {
            selectDate(availableDates.value[idx + 1])
        }
    }

    function canPrevDate() {
        return availableDates.value.indexOf(selectedDate.value) > 0
    }

    function canNextDate() {
        const idx = availableDates.value.indexOf(selectedDate.value)
        return idx < availableDates.value.length - 1
    }

    function getRecordingBaseSegment(rec) {
        const analysis = analysisCache.get(rec.filename)

        // If JSONL data available, use real time range
        if (analysis?.realTimeRange) {
            const { start, end } = analysis.realTimeRange
            const lastSeg = analysis.activeSegments[analysis.activeSegments.length - 1]
            return {
                start,
                end,
                audioStart: 0,
                audioEnd: lastSeg?.audioEnd ?? 0,
                recording: rec
            }
        }

        // Fallback: use audio duration
        const actualDuration = rec.audioDuration && isFinite(rec.audioDuration) ? rec.audioDuration : 60
        return {
            start: rec.timeOfDay,
            end: rec.timeOfDay + actualDuration,
            audioStart: 0,
            audioEnd: actualDuration,
            recording: rec
        }
    }

    // Preserved for future timestamp mapping feature
    function isRecordingAnalyzed(rec) {
        const analysis = analysisCache.get(rec.filename)
        return analysis && analysis.activeSegments && analysis.activeSegments.length > 0
    }

    function getRecordingActiveSegments(rec) {
        const analysis = analysisCache.get(rec.filename)

        if (!analysis || !analysis.activeSegments || analysis.activeSegments.length === 0) {
            return []
        }

        return analysis.activeSegments.map(seg => ({
            start: seg.start,
            end: seg.end,
            audioStart: seg.audioStart,
            audioEnd: seg.audioEnd,
            recording: rec
        }))
    }

    // Load JSONL timestamp data for a recording
    async function loadTimestampData(rec) {
        const jsonlUrl = rec.href.replace('.mp3', '.jsonl')
        try {
            const resp = await fetch(jsonlUrl, { cache: 'no-store' })
            if (!resp.ok) return
            const content = await resp.text()
            const chunks = parseJsonlContent(content)
            const { segments, realTimeRange } = chunksToActiveSegments(chunks)
            analysisCache.set(rec.filename, {
                activeSegments: segments,
                realTimeRange
            })
        } catch (e) {
            // Silent fail - will use fallback rendering
        }
    }

    // Load all timestamp data for current recordings
    async function loadAllTimestamps() {
        await Promise.all(recordings.value.map(loadTimestampData))
    }

    return {
        // State
        recordings,
        selectedDate,
        selectedFreq,
        analysisCache,  // Preserved for future timestamp mapping feature
        // Constants
        SECONDS_PER_DAY,
        // Computed
        availableDates,
        availableFreqs,
        freqStats,
        filteredRecordings,
        crossDayRecordings,
        timelineRecordings,
        // Methods
        parseFilesFromDOM,
        selectDate,
        selectFreq,
        prevDate,
        nextDate,
        canPrevDate,
        canNextDate,
        getRecordingBaseSegment,
        isRecordingAnalyzed,
        getRecordingActiveSegments,
        loadAllTimestamps
    }
}

export default useRecordings
