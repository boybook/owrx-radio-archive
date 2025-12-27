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
import { SECONDS_PER_DAY, STORAGE_KEY_FREQ } from '../modules/constants.js'
import {
    formatDateKey,
    getDayOffset,
    timeOfDayFromDate,
    clampTimeToDay,
    isTimeOutOfDay
} from '../modules/dateUtils.js'

export function useRecordings() {
    // State
    const recordings = ref([])
    const selectedDate = ref(null)
    const selectedFreq = ref(null)
    // analysisCache preserved for future timestamp mapping feature
    const analysisCache = reactive(new Map())

    // Get the physical end time of a recording (based on JSONL data if available)
    // Returns time in seconds relative to recording start date (can exceed SECONDS_PER_DAY for cross-day)
    function getRecordingPhysicalEndTime(rec) {
        const cached = analysisCache.get(rec.filename)
        if (cached?.rawChunks?.length) {
            // Use JSONL last chunk's end time
            const lastChunk = cached.rawChunks[cached.rawChunks.length - 1]
            const utc = new Date(lastChunk.start_utc)
            const endUtc = new Date(utc.getTime() + lastChunk.duration_ms)

            // Calculate day offset from recording start date
            const dayOffset = getDayOffset(rec.date, endUtc)
            const endTimeOfDay = timeOfDayFromDate(endUtc)
            return endTimeOfDay + dayOffset * SECONDS_PER_DAY
        }
        // Fallback: use audioDuration
        const duration = rec.audioDuration && isFinite(rec.audioDuration) ? rec.audioDuration : 0
        return rec.timeOfDay + duration
    }

    // Computed
    const availableDates = computed(() => {
        const dates = new Set()
        recordings.value.forEach(r => {
            // 添加原始日期
            dates.add(r.dateKey)

            // 使用物理结束时间判断跨日（基于 JSONL 数据）
            const physicalEndTime = getRecordingPhysicalEndTime(r)
            if (physicalEndTime > SECONDS_PER_DAY) {
                // 计算跨越了多少天
                const daysSpanned = Math.floor(physicalEndTime / SECONDS_PER_DAY)
                for (let i = 1; i <= daysSpanned; i++) {
                    const nextDate = new Date(r.date)
                    nextDate.setDate(nextDate.getDate() + i)
                    dates.add(formatDateKey(nextDate))
                }
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

    // Cross-day recordings (from previous days extending into current day)
    const crossDayRecordings = computed(() => {
        if (!selectedDate.value) return []

        const currentDate = new Date(selectedDate.value + 'T00:00:00')

        return recordings.value
            .filter(r => {
                // Recording must start before the selected date
                const dayOffset = getDayOffset(r.date, currentDate)
                if (dayOffset <= 0) return false

                if (selectedFreq.value && r.frequency !== selectedFreq.value) return false

                // Check if recording extends into the selected date using physical end time
                const physicalEndTime = getRecordingPhysicalEndTime(r)
                return physicalEndTime > dayOffset * SECONDS_PER_DAY
            })
            .map(r => {
                // Calculate the day offset for time adjustment
                const dayOffset = getDayOffset(r.date, currentDate)
                const offsetTime = r.timeOfDay - dayOffset * SECONDS_PER_DAY

                return {
                    ...r,
                    timeOfDay: offsetTime,
                    isCrossDay: true,
                    crossDayOffset: dayOffset  // Store for segment calculation
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
            // Pass recording start date to handle cross-day time calculation
            const fullAnalysis = chunksToActiveSegments(cached.rawChunks, {
                skipShort: false,
                recordingStartDate: rec.date
            })

            if (fullAnalysis?.realTimeRange) {
                let { start, end } = fullAnalysis.realTimeRange
                const lastSeg = fullAnalysis.segments[fullAnalysis.segments.length - 1]

                // 跨日录音时间调整：将原始时间偏移到当前日期视图
                if (rec.isCrossDay) {
                    const offset = (rec.crossDayOffset || 1) * SECONDS_PER_DAY
                    start -= offset
                    end -= offset
                }

                // 裁剪 start 和 end 到当天边界
                start = clampTimeToDay(start)
                end = clampTimeToDay(end)

                // Check if all segments would be filtered (for skip logic)
                let allSkipped = false
                if (skipShort) {
                    const filteredAnalysis = chunksToActiveSegments(cached.rawChunks, {
                        skipShort: true,
                        shortThresholdMs: 2048,
                        recordingStartDate: rec.date
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
        const end = clampTimeToDay(rec.timeOfDay + actualDuration)

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

        // Pass recording start date to handle cross-day time calculation
        const analysis = chunksToActiveSegments(cached.rawChunks, {
            skipShort,
            shortThresholdMs: 2048,
            recordingStartDate: rec.date
        })

        if (!analysis?.segments?.length) {
            return []
        }

        return analysis.segments.map(seg => {
            let start = seg.start
            let end = seg.end

            // 跨日录音时间调整：将原始时间偏移到当前日期视图
            if (rec.isCrossDay) {
                const offset = (rec.crossDayOffset || 1) * SECONDS_PER_DAY
                start -= offset
                end -= offset
            }

            // 如果片段完全在当天之外，跳过
            if (isTimeOutOfDay(start, end)) {
                return null
            }

            // 裁剪 start 和 end 到当天边界
            start = clampTimeToDay(start)
            end = clampTimeToDay(end)

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
        // After loading JSONL data, update default date to latest available
        // (cross-day recordings may add new dates)
        if (availableDates.value.length > 0) {
            const latestDate = availableDates.value[availableDates.value.length - 1]
            if (selectedDate.value !== latestDate) {
                selectedDate.value = latestDate
            }
        }
    }

    return {
        // State
        recordings,
        selectedDate,
        selectedFreq,
        analysisCache,  // Preserved for future timestamp mapping feature
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
