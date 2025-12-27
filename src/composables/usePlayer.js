/**
 * usePlayer - Audio player state and logic composable
 */
import { ref } from 'vue'
import { formatDuration } from '../modules/fileParser.js'
import { getPlayableUrl, onLoadingChange, revokeAllBlobUrls, revokeBlobUrl } from '../modules/audioSourceManager.js'
import { SECONDS_PER_DAY } from '../modules/constants.js'
import { formatDateKey } from '../modules/dateUtils.js'

export function usePlayer(recordingsState) {
    const {
        recordings,
        filteredRecordings,
        getRecordingActiveSegments,
        canNextDate,
        nextDate
    } = recordingsState

    // State
    const audio = ref(null)
    const currentTrack = ref(null)
    const currentIndex = ref(-1)
    const isPlaying = ref(false)
    const isLoading = ref(false)  // 音频加载状态（用于 Blob 模式下载）
    const currentTime = ref(0)
    const duration = ref(0)
    const volume = ref(1)
    const playbackRate = ref(1)
    const continuousPlay = ref(true)
    const skipShortSegments = ref(true)  // Skip short segments by default

    // 注册加载状态回调
    onLoadingChange((loading) => {
        isLoading.value = loading
    })

    // Methods
    function initAudio() {
        if (!audio.value) {
            audio.value = new Audio()
            audio.value.addEventListener('timeupdate', onTimeUpdate)
            audio.value.addEventListener('loadedmetadata', onLoadedMetadata)
            audio.value.addEventListener('durationchange', onDurationChange)
            audio.value.addEventListener('ended', onEnded)
            audio.value.addEventListener('play', () => isPlaying.value = true)
            audio.value.addEventListener('pause', () => isPlaying.value = false)
        }
    }

    async function play(recording, index, startPosition = 0, endPosition = null) {
        initAudio()

        // If same track, check if we should toggle or seek
        if (currentTrack.value?.filename === recording.filename) {
            const currentAudioTime = audio.value.currentTime

            // 判断当前播放时间是否在点击的片段范围内
            const isInClickedSegment = endPosition !== null
                ? (currentAudioTime >= startPosition && currentAudioTime < endPosition)
                : (startPosition === 0)  // base segment 点击时，position=0 表示整个录音

            if (isInClickedSegment) {
                // 在当前片段内，toggle 播放/暂停
                if (isPlaying.value) {
                    audio.value.pause()
                } else {
                    audio.value.play()
                }
            } else {
                // 不在当前片段，跳转到目标位置
                audio.value.currentTime = startPosition
                if (!isPlaying.value) {
                    audio.value.play()
                }
            }
            return
        }

        currentTrack.value = recording
        currentIndex.value = index !== undefined ? index : filteredRecordings.value.indexOf(recording)

        // Use preloaded duration from DOM
        if (recording.audioDuration && isFinite(recording.audioDuration)) {
            duration.value = recording.audioDuration
        } else {
            duration.value = 0
        }

        // Check if this is the latest recording for its frequency (actively being written)
        const sameFreqRecordings = recordings.value.filter(r => r.frequency === recording.frequency)
        const latestForFreq = sameFreqRecordings.reduce((latest, r) =>
            !latest || r.date > latest.date ? r : latest, null)
        const isLatest = latestForFreq?.filename === recording.filename

        // 通过 audioSourceManager 获取可播放的 URL
        // Chrome/Firefox 直接返回原 URL，其他浏览器返回 Blob URL
        const audioSrc = await getPlayableUrl(recording.href, { bustCache: isLatest })
        audio.value.src = audioSrc
        audio.value.volume = volume.value
        audio.value.playbackRate = playbackRate.value

        if (startPosition > 0) {
            audio.value.addEventListener('loadedmetadata', function seekOnce() {
                audio.value.currentTime = startPosition
                audio.value.removeEventListener('loadedmetadata', seekOnce)
            })
        }

        audio.value.play()
    }

    function playAtPosition(recording, position, endPosition = null) {
        const index = filteredRecordings.value.indexOf(recording)
        play(recording, index, position, endPosition)
    }

    function togglePlay() {
        if (!audio.value) return
        if (isPlaying.value) {
            audio.value.pause()
        } else {
            audio.value.play()
        }
    }

    function playPrev() {
        let prevIdx = currentIndex.value - 1

        while (prevIdx >= 0) {
            const prevRec = filteredRecordings.value[prevIdx]

            if (!skipShortSegments.value) {
                play(prevRec, prevIdx)
                return
            }

            const baseSeg = recordingsState.getRecordingBaseSegment(prevRec, true)
            if (!baseSeg?.allSkipped) {
                play(prevRec, prevIdx)
                return
            }
            prevIdx--
        }
    }

    function playNext() {
        let nextIdx = currentIndex.value + 1

        while (nextIdx < filteredRecordings.value.length) {
            const nextRec = filteredRecordings.value[nextIdx]

            if (!skipShortSegments.value) {
                play(nextRec, nextIdx)
                return
            }

            const baseSeg = recordingsState.getRecordingBaseSegment(nextRec, true)
            if (!baseSeg?.allSkipped) {
                play(nextRec, nextIdx)
                return
            }
            nextIdx++
        }

        // 当天没有更多录音时，尝试切换到下一天
        if (canNextDate()) {
            nextDate()

            // 等待 filteredRecordings 更新后播放下一天的第一个录音
            setTimeout(() => {
                const nextDayRecordings = filteredRecordings.value
                if (nextDayRecordings.length > 0) {
                    let firstIdx = 0

                    // 如果启用了跳过短片段，找第一个有效录音
                    if (skipShortSegments.value) {
                        while (firstIdx < nextDayRecordings.length) {
                            const rec = nextDayRecordings[firstIdx]
                            const baseSeg = recordingsState.getRecordingBaseSegment(rec, true)
                            if (!baseSeg?.allSkipped) {
                                break
                            }
                            firstIdx++
                        }
                    }

                    if (firstIdx < nextDayRecordings.length) {
                        play(nextDayRecordings[firstIdx], firstIdx)
                        return
                    }
                }
                // 下一天也没有有效录音，停止播放
                if (audio.value) {
                    audio.value.pause()
                }
                isPlaying.value = false
            }, 0)
            return
        }

        // No more valid recordings, stop playback
        if (audio.value) {
            audio.value.pause()
        }
        isPlaying.value = false
    }

    function getSeekableDuration() {
        if (duration.value && isFinite(duration.value) && duration.value > 0) {
            return duration.value
        }

        if (!audio.value) return 0

        try {
            if (audio.value.seekable && audio.value.seekable.length > 0) {
                const seekableEnd = audio.value.seekable.end(audio.value.seekable.length - 1)
                if (isFinite(seekableEnd) && seekableEnd > 0) {
                    return seekableEnd
                }
            }
        } catch (e) { }

        try {
            if (audio.value.buffered && audio.value.buffered.length > 0) {
                const bufferedEnd = audio.value.buffered.end(audio.value.buffered.length - 1)
                if (isFinite(bufferedEnd) && bufferedEnd > 0) {
                    return bufferedEnd
                }
            }
        } catch (e) { }

        return Math.max(currentTime.value * 2, 60)
    }

    function seek(e) {
        if (!audio.value) return

        const seekableDuration = getSeekableDuration()
        if (seekableDuration <= 0) return

        const percent = e.target.value / 100
        const newTime = percent * seekableDuration
        if (isFinite(newTime) && newTime >= 0) {
            audio.value.currentTime = newTime
        }
    }

    function setVolume(e) {
        volume.value = e.target.value / 100
        if (audio.value) {
            audio.value.volume = volume.value
        }
    }

    function setSpeed(e) {
        playbackRate.value = parseFloat(e.target.value)
        if (audio.value) {
            audio.value.playbackRate = playbackRate.value
        }
    }

    function onTimeUpdate() {
        currentTime.value = audio.value.currentTime

        // Skip short segments during playback
        if (skipShortSegments.value && currentTrack.value && isPlaying.value) {
            const activeSegments = getRecordingActiveSegments(currentTrack.value, true)

            if (activeSegments.length > 0) {
                const time = audio.value.currentTime

                // Check if current time is within any active segment
                const inActiveSegment = activeSegments.some(seg =>
                    time >= seg.audioStart && time < seg.audioEnd
                )

                if (!inActiveSegment) {
                    // Find next active segment
                    const nextSegment = activeSegments.find(seg => seg.audioStart > time)

                    if (nextSegment) {
                        // Jump to next active segment
                        audio.value.currentTime = nextSegment.audioStart
                    } else {
                        // No more active segments, trigger end
                        if (continuousPlay.value) {
                            playNext()
                        } else {
                            audio.value.pause()
                            isPlaying.value = false
                        }
                    }
                }
            }
        }
    }

    function onLoadedMetadata() {
        if (isFinite(audio.value.duration)) {
            duration.value = audio.value.duration
            if (currentTrack.value) {
                currentTrack.value.audioDuration = audio.value.duration
            }
        }
    }

    function onDurationChange() {
        if (isFinite(audio.value.duration) && audio.value.duration > 0) {
            duration.value = audio.value.duration

            if (currentTrack.value) {
                const index = recordings.value.findIndex(r => r.filename === currentTrack.value.filename)
                if (index !== -1 && !recordings.value[index].audioDuration) {
                    recordings.value[index] = {
                        ...recordings.value[index],
                        audioDuration: audio.value.duration
                    }
                }
            }
        }
    }

    function onEnded() {
        if (continuousPlay.value && currentIndex.value < filteredRecordings.value.length - 1) {
            playNext()
        } else {
            isPlaying.value = false
        }
    }

    function formatTime(seconds) {
        return formatDuration(seconds)
    }

    function getProgressPercent() {
        const seekableDuration = getSeekableDuration()
        if (seekableDuration <= 0) return 0
        return Math.min(100, (currentTime.value / seekableDuration) * 100)
    }

    function isCurrentlyPlaying(rec) {
        return currentTrack.value?.filename === rec.filename
    }

    function stopPlayback() {
        if (audio.value) {
            audio.value.pause()
            audio.value.src = ''
        }
        currentTrack.value = null
        currentIndex.value = -1
        isPlaying.value = false
        currentTime.value = 0
        duration.value = 0
    }

    // Refresh current audio (reload from server, maintain playback position)
    async function refreshCurrentAudio() {
        if (!currentTrack.value || !audio.value) return

        const savedTime = audio.value.currentTime
        const wasPlaying = isPlaying.value

        // Clear blob cache for this file
        revokeBlobUrl(currentTrack.value.href)

        // Reload audio with cache busting
        const audioSrc = await getPlayableUrl(currentTrack.value.href, { bustCache: true })
        audio.value.src = audioSrc

        // Restore playback position and state
        audio.value.addEventListener('loadedmetadata', function seekOnce() {
            audio.value.currentTime = savedTime
            if (wasPlaying) audio.value.play()
            audio.value.removeEventListener('loadedmetadata', seekOnce)
        })

        audio.value.load()
    }

    // Check if current track matches filters (for date/freq change)
    function checkCurrentTrackFilters(newDate, newFreq, oldDate, oldFreq) {
        if (!currentTrack.value) return

        // Date changed
        if (oldDate !== newDate) {
            const trackDate = currentTrack.value.dateKey
            const matchesCurrent = trackDate === newDate

            let matchesCrossDay = false
            if (trackDate !== newDate) {
                const dur = currentTrack.value.audioDuration || 0
                if (currentTrack.value.timeOfDay + dur > SECONDS_PER_DAY) {
                    const nextDateObj = new Date(currentTrack.value.date)
                    nextDateObj.setDate(nextDateObj.getDate() + 1)
                    matchesCrossDay = formatDateKey(nextDateObj) === newDate
                }
            }

            if (!matchesCurrent && !matchesCrossDay) {
                stopPlayback()
            }
        }

        // Frequency changed
        if (oldFreq !== newFreq) {
            if (newFreq && currentTrack.value.frequency !== newFreq) {
                stopPlayback()
            }
        }
    }

    return {
        // State
        audio,
        currentTrack,
        currentIndex,
        isPlaying,
        isLoading,
        currentTime,
        duration,
        volume,
        playbackRate,
        continuousPlay,
        skipShortSegments,
        // Methods
        initAudio,
        play,
        playAtPosition,
        togglePlay,
        playPrev,
        playNext,
        seek,
        setVolume,
        setSpeed,
        formatTime,
        getProgressPercent,
        isCurrentlyPlaying,
        stopPlayback,
        refreshCurrentAudio,
        checkCurrentTrackFilters
    }
}

export default usePlayer
