/**
 * usePlayer - Audio player state and logic composable
 */
import { ref } from 'vue'
import { formatDuration } from '../modules/fileParser.js'

export function usePlayer(recordingsState) {
    const {
        recordings,
        filteredRecordings,
        SECONDS_PER_DAY
    } = recordingsState

    // State
    const audio = ref(null)
    const currentTrack = ref(null)
    const currentIndex = ref(-1)
    const isPlaying = ref(false)
    const currentTime = ref(0)
    const duration = ref(0)
    const volume = ref(1)
    const playbackRate = ref(1)
    const continuousPlay = ref(true)

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

    function play(recording, index, startPosition = 0) {
        initAudio()

        // If clicking on same track, toggle play/pause
        if (currentTrack.value?.filename === recording.filename && startPosition === 0) {
            if (isPlaying.value) {
                audio.value.pause()
            } else {
                audio.value.play()
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

        audio.value.src = recording.href
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

    function playAtPosition(recording, position) {
        const index = filteredRecordings.value.indexOf(recording)
        play(recording, index, position)
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
        if (currentIndex.value > 0) {
            const idx = currentIndex.value - 1
            play(filteredRecordings.value[idx], idx)
        }
    }

    function playNext() {
        if (currentIndex.value < filteredRecordings.value.length - 1) {
            const idx = currentIndex.value + 1
            play(filteredRecordings.value[idx], idx)
        }
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
                    const nextDate = new Date(currentTrack.value.date)
                    nextDate.setDate(nextDate.getDate() + 1)
                    const nextDateKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
                    matchesCrossDay = nextDateKey === newDate
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
        currentTime,
        duration,
        volume,
        playbackRate,
        continuousPlay,
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
        checkCurrentTrackFilters
    }
}

export default usePlayer
