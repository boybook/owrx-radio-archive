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
                    :getRecordingBaseSegment="getRecordingBaseSegment"
                    :getRecordingActiveSegments="getRecordingActiveSegments"
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
                    @play="playAtPosition"
                />

                <!-- Player -->
                <PlayerControls
                    :currentTrack="currentTrack"
                    :currentTime="currentTime"
                    :duration="duration"
                    :isPlaying="isPlaying"
                    :volume="volume"
                    :playbackRate="playbackRate"
                    :continuousPlay="continuousPlay"
                    :skipSilence="skipSilence"
                    :progressPercent="getProgressPercent()"
                    :analysisState="analysisState"
                    :currentAnalysis="currentAnalysis"
                    @toggle="togglePlay"
                    @prev="playPrev"
                    @next="playNext"
                    @seek="seek"
                    @volume="setVolume"
                    @speed="setSpeed"
                    @update:continuousPlay="continuousPlay = $event"
                    @update:skipSilence="skipSilence = $event"
                />

                <!-- Recording List -->
                <RecordingList
                    :recordings="filteredRecordings"
                    :isCurrentlyPlaying="isCurrentlyPlaying"
                    @play="play"
                    @refresh="refreshRecording"
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

        // View state
        const activeView = ref('timeline')

        // Recordings state
        const recordingsState = useRecordings()
        const {
            recordings,
            selectedDate,
            selectedFreq,
            analysisCache,
            analysisState,
            analysisProgress,
            availableDates,
            availableFreqs,
            freqStats,
            filteredRecordings,
            timelineRecordings,
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
            getRecordingActiveSegments,
            SECONDS_PER_DAY
        } = recordingsState

        // Player state
        const playerState = usePlayer(recordingsState)
        const {
            currentTrack,
            currentIndex,
            isPlaying,
            currentTime,
            duration,
            volume,
            playbackRate,
            continuousPlay,
            skipSilence,
            currentAnalysis,
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
            getPlayheadStyle
        } = timelineState

        // Methods
        function switchView(view) {
            activeView.value = view
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
        })

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
                await loadCachedAnalysis()
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
            analysisState,
            analysisProgress,
            analysisCache,
            handleDateSelect,
            handleFreqSelect,
            prevDate,
            nextDate,
            canPrevDate,
            canNextDate,
            getRecordingBaseSegment,
            isRecordingAnalyzed,
            getRecordingActiveSegments,
            refreshRecording,
            // Player
            currentTrack,
            currentTime,
            duration,
            isPlaying,
            volume,
            playbackRate,
            continuousPlay,
            skipSilence,
            currentAnalysis,
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
            getPlayheadStyle
        }
    }
}
</script>
