<template>
    <div class="radio-archive-section">
        <div class="player-container">
            <!-- Analysis status -->
            <div class="player-analysis" v-if="analysisState !== 'idle' && analysisState !== 'ready'">
                <div class="analysis-info">
                    <span class="analysis-spinner-small"></span>
                    <span class="analysis-text">{{ getAnalysisStateText() }}</span>
                </div>
            </div>

            <!-- Normal playback info -->
            <div class="player-now-playing" v-else>
                <span class="player-track-name">
                    {{ currentTrack ? formatDisplayTime(currentTrack) + ' - ' + formatFreq(currentTrack.frequency) : t('noTrackSelected') }}
                </span>
                <span class="player-time">
                    {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
                    <template v-if="currentAnalysis">
                        ({{ currentAnalysis.activeSegments.length }} {{ t('activeSegments') }})
                    </template>
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
                <button class="player-btn play-btn" @click="$emit('toggle')" :disabled="!currentTrack">
                    {{ isPlaying ? '&#10074;&#10074;' : '&#9654;' }}
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
                    <label class="skip-silence">
                        <input type="checkbox" :checked="skipSilence" @change="$emit('update:skipSilence', $event.target.checked)">
                        <span>{{ t('skipSilence') }}</span>
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
        skipSilence: {
            type: Boolean,
            default: true
        },
        progressPercent: {
            type: Number,
            default: 0
        },
        analysisState: {
            type: String,
            default: 'idle'
        },
        currentAnalysis: {
            type: Object,
            default: null
        }
    },
    emits: ['toggle', 'prev', 'next', 'seek', 'volume', 'speed', 'update:continuousPlay', 'update:skipSilence'],
    setup() {
        function getAnalysisStateText() {
            const texts = {
                downloading: t('downloadingAudio'),
                decoding: t('decodingAudio'),
                analyzing: t('analyzingSilence')
            }
            return texts[arguments[0]] || ''
        }

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
            formatTime,
            getAnalysisStateText: function() {
                const texts = {
                    downloading: t('downloadingAudio'),
                    decoding: t('decodingAudio'),
                    analyzing: t('analyzingSilence')
                }
                return texts[this.analysisState] || ''
            }
        }
    }
}
</script>
