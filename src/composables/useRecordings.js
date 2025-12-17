/**
 * useRecordings - Recording data management composable
 */
import { ref, reactive, computed } from 'vue'
import { parseFilename } from '../modules/fileParser.js'
import { SilenceAnalyzer } from '../modules/silenceAnalyzer.js'

export function useRecordings() {
    // State
    const recordings = ref([])
    const selectedDate = ref(null)
    const selectedFreq = ref(null)
    const analysisCache = reactive(new Map())
    const analysisState = ref('idle')  // 'idle' | 'downloading' | 'decoding' | 'analyzing' | 'ready'
    const analysisProgress = ref(0)

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

                const analysis = analysisCache.get(r.filename)
                const duration = analysis?.duration
                    || (r.audioDuration && isFinite(r.audioDuration) ? r.audioDuration : 0)

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

        const fileLinks = document.querySelectorAll('.file-tile a[href^="files/"]')
        console.log('[RadioArchive] Found file links:', fileLinks.length)

        const files = []
        fileLinks.forEach(link => {
            const href = link.getAttribute('href')
            const filename = href.replace('files/', '')
            const parsed = parseFilename(filename)
            if (parsed) {
                files.push(parsed)
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
    }

    async function loadCachedAnalysis() {
        console.log('[RadioArchive] Loading cached analysis data...')
        let loadedCount = 0

        for (let i = 0; i < recordings.value.length; i++) {
            const rec = recordings.value[i]
            const cached = await SilenceAnalyzer.getFromCache(rec.filename)

            if (cached && cached.segments) {
                analysisCache.set(rec.filename, cached)
                if (cached.duration && isFinite(cached.duration)) {
                    recordings.value[i] = {
                        ...recordings.value[i],
                        audioDuration: cached.duration
                    }
                }
                loadedCount++
            }
        }

        console.log('[RadioArchive] Loaded cached analysis for', loadedCount, 'recordings')
    }

    async function analyzeRecording(recording) {
        const isRecent = SilenceAnalyzer.isRecordingRecent(
            recording.filename,
            2 * 60 * 60 * 1000,
            recordings.value
        )

        if (!isRecent && analysisCache.has(recording.filename)) {
            return analysisCache.get(recording.filename)
        }

        analysisState.value = 'downloading'
        analysisProgress.value = 0

        try {
            const result = await SilenceAnalyzer.analyze(
                recording.href,
                recording.filename,
                {
                    silenceThreshold: 0.01,
                    minSilenceDuration: 2,
                    allRecordings: recordings.value,
                    onProgress: ({ stage, progress }) => {
                        analysisState.value = stage
                        analysisProgress.value = Math.round(progress * 100)
                    }
                }
            )

            analysisCache.set(recording.filename, result)

            if (result && result.duration) {
                const index = recordings.value.findIndex(r => r.filename === recording.filename)
                if (index !== -1) {
                    recordings.value[index] = {
                        ...recordings.value[index],
                        audioDuration: result.duration
                    }
                }
            }

            analysisState.value = 'ready'
            return result
        } catch (e) {
            console.error('[RadioArchive] Analysis failed:', e)
            analysisState.value = 'idle'
            return null
        }
    }

    async function refreshRecording(recording) {
        console.log('[RadioArchive] Force refreshing:', recording.filename)
        analysisCache.delete(recording.filename)
        await SilenceAnalyzer.deleteFromCache(recording.filename)
        await analyzeRecording(recording)
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
        const actualDuration = analysis?.duration
            || (rec.audioDuration && isFinite(rec.audioDuration) ? rec.audioDuration : 60)

        return {
            start: rec.timeOfDay,
            end: rec.timeOfDay + actualDuration,
            audioStart: 0,
            audioEnd: actualDuration,
            recording: rec
        }
    }

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
            start: rec.timeOfDay + seg.start,
            end: rec.timeOfDay + seg.end,
            audioStart: seg.start,
            audioEnd: seg.end,
            recording: rec
        }))
    }

    return {
        // State
        recordings,
        selectedDate,
        selectedFreq,
        analysisCache,
        analysisState,
        analysisProgress,
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
        loadCachedAnalysis,
        analyzeRecording,
        refreshRecording,
        selectDate,
        selectFreq,
        prevDate,
        nextDate,
        canPrevDate,
        canNextDate,
        getRecordingBaseSegment,
        isRecordingAnalyzed,
        getRecordingActiveSegments
    }
}

export default useRecordings
