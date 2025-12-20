<template>
    <div class="radio-archive-section">
        <div class="player-container">
            <!-- Playback info -->
            <div class="player-now-playing">
                <span class="player-track-name">
                    {{ currentTrack ? formatDisplayTime(currentTrack) + ' - ' + formatFreq(currentTrack.frequency) : t('noTrackSelected') }}
                </span>
                <span class="player-time">
                    {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
                </span>
            </div>

            <input
                type="range"
                class="player-progress-bar"
                min="0"
                max="100"
                :value="progressPercent"
                @input="$emit('seek', $event)"
                :style="{ '--progress': progressPercent + '%' }">

            <div class="player-controls">
                <button class="player-btn" @click="$emit('prev')" :disabled="!currentTrack">&#9198;</button>
                <button class="player-btn play-btn" @click="$emit('toggle')" :disabled="!currentTrack || isLoading">
                    <span v-if="isLoading" class="loading-spinner"></span>
                    <span v-else v-html="isPlaying ? '&#10074;&#10074;' : '&#9654;'"></span>
                </button>
                <button class="player-btn" @click="$emit('next')" :disabled="!currentTrack">&#9197;</button>

                <div class="player-spacer"></div>

                <div class="player-volume">
                    <span>&#128266;</span>
                    <input
                        type="range"
                        class="volume-slider"
                        min="0"
                        max="100"
                        :value="volume * 100"
                        @input="$emit('volume', $event)">
                </div>

                <select class="speed-select" :value="playbackRate" @change="$emit('speed', $event)">
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1">1.0x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2.0x</option>
                </select>

                <div class="player-options">
                    <label class="continuous-play">
                        <input type="checkbox" :checked="continuousPlay" @change="$emit('update:continuousPlay', $event.target.checked)">
                        <span>{{ t('auto') }}</span>
                    </label>
                    <label class="skip-short-segments">
                        <input type="checkbox" :checked="skipShortSegments" @change="$emit('update:skipShortSegments', $event.target.checked)">
                        <span>{{ t('skipShort') }}</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { t } from '../modules/i18n.js'
import { formatFreq, formatTime as formatTimeUtil, formatDuration } from '../modules/fileParser.js'

export default {
    name: 'PlayerControls',
    props: {
        currentTrack: {
            type: Object,
            default: null
        },
        currentTime: {
            type: Number,
            default: 0
        },
        duration: {
            type: Number,
            default: 0
        },
        isPlaying: {
            type: Boolean,
            default: false
        },
        isLoading: {
            type: Boolean,
            default: false
        },
        volume: {
            type: Number,
            default: 1
        },
        playbackRate: {
            type: Number,
            default: 1
        },
        continuousPlay: {
            type: Boolean,
            default: true
        },
        skipShortSegments: {
            type: Boolean,
            default: true
        },
        progressPercent: {
            type: Number,
            default: 0
        }
    },
    emits: ['toggle', 'prev', 'next', 'seek', 'volume', 'speed', 'update:continuousPlay', 'update:skipShortSegments'],
    setup() {
        function formatDisplayTime(rec) {
            return formatTimeUtil(rec.date)
        }

        function formatTime(seconds) {
            return formatDuration(seconds)
        }

        return {
            t,
            formatFreq,
            formatDisplayTime,
            formatTime
        }
    }
}
</script>

<style scoped>
.loading-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
