<template>
    <div class="radio-archive-wrapper">
        <!-- Tab Bar -->
        <div class="radio-archive-tabs">
            <button
                class="tab-btn"
                :class="{ active: activeView === 'original' }"
                @click="switchView('original')">
                {{ t('receivedFiles') }}
            </button>
            <button
                class="tab-btn"
                :class="{ active: activeView === 'timeline' }"
                @click="switchView('timeline')">
                {{ t('radioArchive') }}
            </button>
        </div>

        <!-- Timeline View -->
        <div class="radio-archive-view" :class="{ active: activeView === 'timeline' }">
            <div class="radio-archive" v-if="recordings.length > 0">

                <!-- Frequency Selector -->
                <FrequencySelector
                    :availableFreqs="availableFreqs"
                    :selectedFreq="selectedFreq"
                    :freqStats="freqStats"
                    @select="handleFreqSelect"
                />

                <!-- Date Selector -->
                <DateSelector
                    :selectedDate="selectedDate"
                    :canPrev="canPrevDate()"
                    :canNext="canNextDate()"
                    @select="handleDateSelect"
                    @prev="prevDate"
                    @next="nextDate"
                />

                <!-- Timeline -->
                <Timeline
                    :timelineRecordings="timelineRecordings"
                    :currentTrack="currentTrack"
                    :currentTime="currentTime"
                    :zoomLevel="zoomLevel"
                    :isDragging="isDragging"
                    :timelineTicks="timelineTicks"
                    :visibleDurationLabel="visibleDurationLabel"
                    :getSubSegmentStyle="getSubSegmentStyle"
                    :getRecordingBaseSegment="wrappedGetRecordingBaseSegment"
                    :getRecordingActiveSegments="wrappedGetRecordingActiveSegments"
                    :isCurrentlyPlaying="isCurrentlyPlaying"
                    :getPlayheadStyle="getPlayheadStyle"
                    :handleWheel="handleWheel"
                    :handlePointerDown="handlePointerDown"
                    :handlePointerMove="handlePointerMove"
                    :handlePointerUp="handlePointerUp"
                    :handleTouchStart="handleTouchStart"
                    :handleTouchMove="handleTouchMove"
                    :handleTouchEnd="handleTouchEnd"
                    :zoomIn="zoomIn"
                    :zoomOut="zoomOut"
                    :resetZoom="resetZoom"
                    @play="playWithInteraction"
                />

                <!-- Player -->
                <PlayerControls
                    :currentTrack="currentTrack"
                    :currentTime="currentTime"
                    :duration="duration"
                    :isPlaying="isPlaying"
                    :isLoading="isLoading"
                    :volume="volume"
                    :playbackRate="playbackRate"
                    :continuousPlay="continuousPlay"
                    :skipShortSegments="skipShortSegments"
                    :progressPercent="getProgressPercent()"
                    @toggle="togglePlay"
                    @prev="playPrev"
                    @next="playNext"
                    @seek="seek"
                    @volume="setVolume"
                    @speed="setSpeed"
                    @update:continuousPlay="continuousPlay = $event"
                    @update:skipShortSegments="skipShortSegments = $event"
                />

                <!-- Recording List -->
                <RecordingList
                    :recordings="filteredRecordings"
                    :isCurrentlyPlaying="isCurrentlyPlaying"
                    @play="playRecordingWithInteraction"
                />
            </div>

            <!-- Empty State -->
            <div class="empty-state" v-else>
                <p>{{ t('noRecordings') }}</p>
                <p>{{ t('fileNamingHint') }}</p>
            </div>
        </div>
    </div>
</template>

<script>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { t, initI18n } from './modules/i18n.js'
import { audioTimeToTimelineTime, chunksToActiveSegments } from './modules/fileParser.js'
import { useRecordings } from './composables/useRecordings.js'
import { usePlayer } from './composables/usePlayer.js'
import { useTimeline } from './composables/useTimeline.js'

import FrequencySelector from './components/FrequencySelector.vue'
import DateSelector from './components/DateSelector.vue'
import Timeline from './components/Timeline.vue'
import PlayerControls from './components/PlayerControls.vue'
import RecordingList from './components/RecordingList.vue'

export default {
    name: 'RadioArchive',
    components: {
        FrequencySelector,
        DateSelector,
        Timeline,
        PlayerControls,
        RecordingList
    },
    setup() {
        // Initialize i18n
        initI18n()

        // localStorage keys
        const STORAGE_KEY_VIEW = 'radio-archive-active-view'

        // View state - restore from localStorage
        const savedView = localStorage.getItem(STORAGE_KEY_VIEW)
        const activeView = ref(savedView === 'original' ? 'original' : 'timeline')

        // Recordings state
        const recordingsState = useRecordings()
        const {
            recordings,
            selectedDate,
            selectedFreq,
            availableDates,
            availableFreqs,
            freqStats,
            filteredRecordings,
            timelineRecordings,
            analysisCache,
            parseFilesFromDOM,
            selectDate,
            selectFreq,
            prevDate,
            nextDate,
            canPrevDate,
            canNextDate,
            getRecordingBaseSegment,
            getRecordingActiveSegments,
            loadAllTimestamps
        } = recordingsState

        // Player state
        const playerState = usePlayer(recordingsState)
        const {
            currentTrack,
            isPlaying,
            isLoading,
            currentTime,
            duration,
            volume,
            playbackRate,
            continuousPlay,
            skipShortSegments,
            play,
            playAtPosition,
            togglePlay,
            playPrev,
            playNext,
            seek,
            setVolume,
            setSpeed,
            getProgressPercent,
            isCurrentlyPlaying,
            checkCurrentTrackFilters
        } = playerState

        // Timeline state
        const timelineState = useTimeline()
        const {
            zoomLevel,
            viewStartTime,
            timelineRef,
            isDragging,
            timelineTicks,
            visibleDurationLabel,
            zoomIn,
            zoomOut,
            resetZoom,
            handleWheel,
            handlePointerDown,
            handlePointerMove,
            handlePointerUp,
            handleTouchStart,
            handleTouchMove,
            handleTouchEnd,
            getSubSegmentStyle,
            getPlayheadStyleByTime,
            autoFollowPlayhead,
            recordInteraction
        } = timelineState

        // Wrapped functions to pass skipShortSegments
        function wrappedGetRecordingBaseSegment(rec) {
            return getRecordingBaseSegment(rec, skipShortSegments.value)
        }

        function wrappedGetRecordingActiveSegments(rec) {
            return getRecordingActiveSegments(rec, skipShortSegments.value)
        }

        // 包装播放函数，同时记录用户交互（触发滚动冷却）
        function playWithInteraction(recording, position, endPosition = null) {
            recordInteraction()
            playAtPosition(recording, position, endPosition)
        }

        function playRecordingWithInteraction(recording, index) {
            recordInteraction()
            play(recording, index)
        }

        // Wrapped getPlayheadStyle with timestamp mapping
        function getPlayheadStyle(currentTrack, currentTime) {
            if (!currentTrack) return { display: 'none' }

            const cached = analysisCache.get(currentTrack.filename)
            let playheadTime

            if (cached?.rawChunks?.length) {
                // Get segments from raw chunks (unfiltered for playhead)
                const { segments } = chunksToActiveSegments(cached.rawChunks)
                if (segments?.length) {
                    const mapped = audioTimeToTimelineTime(currentTime, segments)
                    playheadTime = mapped ?? (currentTrack.timeOfDay + currentTime)
                } else {
                    playheadTime = currentTrack.timeOfDay + currentTime
                }
            } else {
                playheadTime = currentTrack.timeOfDay + currentTime
            }

            return getPlayheadStyleByTime(playheadTime)
        }

        // 计算播放头在时间轴上的绝对时间
        function getPlayheadTime(track, time) {
            if (!track) return null

            const cached = analysisCache.get(track.filename)

            if (cached?.rawChunks?.length) {
                const { segments } = chunksToActiveSegments(cached.rawChunks)
                if (segments?.length) {
                    const mapped = audioTimeToTimelineTime(time, segments)
                    return mapped ?? (track.timeOfDay + time)
                }
            }

            return track.timeOfDay + time
        }

        // 监听播放状态，实现自动跟随
        watch([isPlaying, currentTime], ([playing, time]) => {
            if (!playing || !currentTrack.value) return

            const playheadTime = getPlayheadTime(currentTrack.value, time)
            if (playheadTime !== null) {
                autoFollowPlayhead(playheadTime)
            }
        }, { flush: 'post' })

        // Methods
        function switchView(view) {
            activeView.value = view
            localStorage.setItem(STORAGE_KEY_VIEW, view)
        }

        function handleDateSelect(dateKey) {
            const oldDate = selectedDate.value
            selectDate(dateKey)
            checkCurrentTrackFilters(dateKey, selectedFreq.value, oldDate, selectedFreq.value)
        }

        function handleFreqSelect(freq) {
            const oldFreq = selectedFreq.value
            selectFreq(freq)
            checkCurrentTrackFilters(selectedDate.value, freq, selectedDate.value, oldFreq)
        }

        // Watch for view changes
        watch(activeView, (newView) => {
            const originalView = document.getElementById('original-files-view')
            if (originalView) {
                originalView.classList.toggle('active', newView === 'original')
            }
        }, { immediate: true })

        // Keyboard shortcuts
        function handleKeydown(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return
            }

            if (e.code === 'Space') {
                e.preventDefault()
                togglePlay()
            }

            if (e.code === 'ArrowLeft') {
                e.preventDefault()
                if (playerState.audio.value) {
                    playerState.audio.value.currentTime = Math.max(0, playerState.audio.value.currentTime - 5)
                }
            }

            if (e.code === 'ArrowRight') {
                e.preventDefault()
                if (playerState.audio.value) {
                    playerState.audio.value.currentTime = playerState.audio.value.currentTime + 5
                }
            }
        }

        onMounted(() => {
            nextTick(async () => {
                parseFilesFromDOM()
                await loadAllTimestamps()
            })

            document.addEventListener('keydown', handleKeydown)
        })

        onUnmounted(() => {
            document.removeEventListener('keydown', handleKeydown)
        })

        return {
            // i18n
            t,
            // View
            activeView,
            switchView,
            // Recordings
            recordings,
            selectedDate,
            selectedFreq,
            availableDates,
            availableFreqs,
            freqStats,
            filteredRecordings,
            timelineRecordings,
            handleDateSelect,
            handleFreqSelect,
            prevDate,
            nextDate,
            canPrevDate,
            canNextDate,
            getRecordingBaseSegment,
            getRecordingActiveSegments,
            wrappedGetRecordingBaseSegment,
            wrappedGetRecordingActiveSegments,
            // Player
            currentTrack,
            currentTime,
            duration,
            isPlaying,
            isLoading,
            volume,
            playbackRate,
            continuousPlay,
            skipShortSegments,
            play,
            playAtPosition,
            togglePlay,
            playPrev,
            playNext,
            seek,
            setVolume,
            setSpeed,
            getProgressPercent,
            isCurrentlyPlaying,
            // Timeline
            zoomLevel,
            isDragging,
            timelineTicks,
            visibleDurationLabel,
            zoomIn,
            zoomOut,
            resetZoom,
            handleWheel,
            handlePointerDown,
            handlePointerMove,
            handlePointerUp,
            handleTouchStart,
            handleTouchMove,
            handleTouchEnd,
            getSubSegmentStyle,
            getPlayheadStyle,
            playWithInteraction,
            playRecordingWithInteraction
        }
    }
}
</script>
