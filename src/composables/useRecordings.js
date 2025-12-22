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
import { getUrlParam, updateUrlParam } from '../utils/urlParams.js'

// localStorage key
const STORAGE_KEY_FREQ = 'radio-archive-selected-freq'

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
        const dates = new Set()
        recordings.value.forEach(r => {
            // 添加原始日期
            dates.add(r.dateKey)
            // 检查跨日延伸
            const duration = r.audioDuration && isFinite(r.audioDuration) ? r.audioDuration : 0
            if (duration > 0 && r.timeOfDay + duration > SECONDS_PER_DAY) {
                // 计算延伸到的下一天日期
                const nextDate = new Date(r.date)
                nextDate.setDate(nextDate.getDate() + 1)
                const nextDateKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
                dates.add(nextDateKey)
            }
        })
        return [...dates].sort()
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
            // 优先级: URL参数 > localStorage > 默认值
            const urlFreq = getUrlParam('freq')
            const savedFreq = localStorage.getItem(STORAGE_KEY_FREQ)

            let targetFreq = null

            // 首先尝试从URL恢复
            if (urlFreq) {
                const freq = parseFloat(urlFreq)
                if (!isNaN(freq) && availableFreqs.value.includes(freq)) {
                    targetFreq = freq
                }
            }

            // 如果URL没有有效频率，尝试localStorage
            if (targetFreq === null && savedFreq) {
                const freq = parseFloat(savedFreq)
                if (availableFreqs.value.includes(freq)) {
                    targetFreq = freq
                }
            }

            // 设置最终值（如果都没有则用第一个）
            selectedFreq.value = targetFreq ?? availableFreqs.value[0]

            // 同步到URL（如果URL没有freq参数）
            if (!urlFreq) {
                updateUrlParam('freq', selectedFreq.value)
            }
        }

        console.log('[RadioArchive] Selected date:', selectedDate.value)
        console.log('[RadioArchive] Selected freq:', selectedFreq.value)
    }

    function selectDate(dateKey) {
        selectedDate.value = dateKey
    }

    function selectFreq(freq) {
        selectedFreq.value = freq
        if (freq !== null) {
            localStorage.setItem(STORAGE_KEY_FREQ, freq.toString())
            updateUrlParam('freq', freq)
        }
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

    // Get base segment for a recording (always uses full data, not filtered)
    function getRecordingBaseSegment(rec, skipShort = false) {
        const cached = analysisCache.get(rec.filename)

        // If JSONL data available, use real time range from full data
        if (cached?.rawChunks?.length) {
            // Always calculate base segment from full (unfiltered) data
            const fullAnalysis = chunksToActiveSegments(cached.rawChunks, { skipShort: false })

            if (fullAnalysis?.realTimeRange) {
                let { start, end } = fullAnalysis.realTimeRange
                const lastSeg = fullAnalysis.segments[fullAnalysis.segments.length - 1]

                // 跨日录音时间调整：将原始时间偏移到当前日期视图
                if (rec.isCrossDay) {
                    start -= SECONDS_PER_DAY
                    end -= SECONDS_PER_DAY
                }

                // 裁剪 end 不超过当天边界
                end = Math.min(end, SECONDS_PER_DAY)

                // Check if all segments would be filtered (for skip logic)
                let allSkipped = false
                if (skipShort) {
                    const filteredAnalysis = chunksToActiveSegments(cached.rawChunks, {
                        skipShort: true,
                        shortThresholdMs: 2048
                    })
                    allSkipped = filteredAnalysis.allSkipped
                }

                return {
                    start,
                    end,
                    audioStart: 0,
                    audioEnd: lastSeg?.audioEnd ?? 0,
                    recording: rec,
                    allSkipped
                }
            }
        }

        // Fallback: use audio duration
        const actualDuration = rec.audioDuration && isFinite(rec.audioDuration) ? rec.audioDuration : 60
        let end = rec.timeOfDay + actualDuration

        // 裁剪 end 不超过当天边界
        end = Math.min(end, SECONDS_PER_DAY)

        return {
            start: rec.timeOfDay,
            end: end,
            audioStart: 0,
            audioEnd: actualDuration,
            recording: rec,
            allSkipped: false
        }
    }

    // Preserved for future timestamp mapping feature
    function isRecordingAnalyzed(rec) {
        const cached = analysisCache.get(rec.filename)
        return cached && cached.rawChunks && cached.rawChunks.length > 0
    }

    // Get active segments for a recording (with optional short segment filtering)
    function getRecordingActiveSegments(rec, skipShort = false) {
        const cached = analysisCache.get(rec.filename)

        if (!cached?.rawChunks?.length) {
            return []
        }

        const analysis = chunksToActiveSegments(cached.rawChunks, {
            skipShort,
            shortThresholdMs: 2048
        })

        if (!analysis?.segments?.length) {
            return []
        }

        return analysis.segments.map(seg => {
            let start = seg.start
            let end = seg.end

            // 跨日录音时间调整：将原始时间偏移到当前日期视图
            if (rec.isCrossDay) {
                start -= SECONDS_PER_DAY
                end -= SECONDS_PER_DAY
            }

            // 裁剪 end 不超过当天边界
            end = Math.min(end, SECONDS_PER_DAY)

            // 如果片段完全在当天之前（裁剪后 start >= end），跳过
            if (start >= end) {
                return null
            }

            return {
                start,
                end,
                audioStart: seg.audioStart,
                audioEnd: seg.audioEnd,
                recording: rec
            }
        }).filter(seg => seg !== null)
    }

    // Check if recording is the latest for its frequency
    function isLatestForFrequency(rec) {
        const sameFreqRecordings = recordings.value.filter(r => r.frequency === rec.frequency)
        const latestForFreq = sameFreqRecordings.reduce((latest, r) =>
            !latest || r.date > latest.date ? r : latest, null)
        return latestForFreq?.filename === rec.filename
    }

    // Load JSONL timestamp data for a recording
    async function loadTimestampData(rec, forceRefresh = false) {
        const jsonlUrl = rec.href.replace('.mp3', '.jsonl')
        try {
            // Disable cache for latest recording or when force refresh
            const fetchOptions = (forceRefresh || isLatestForFrequency(rec)) ? { cache: 'no-store' } : {}
            const resp = await fetch(jsonlUrl, fetchOptions)
            if (!resp.ok) return
            const content = await resp.text()
            const chunks = parseJsonlContent(content)
            // Store raw chunks for dynamic filtering
            analysisCache.set(rec.filename, {
                rawChunks: chunks
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
        loadAllTimestamps,
        loadTimestampData
    }
}

export default useRecordings
