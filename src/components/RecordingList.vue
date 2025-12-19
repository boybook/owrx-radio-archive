<template>
    <div class="radio-archive-section">
        <div class="radio-archive-section-label">
            {{ t('recordings') }} ({{ recordings.length }})
        </div>
        <div class="recording-list-container">
            <ul class="recording-list">
                <li
                    v-for="(rec, idx) in recordings"
                    :key="rec.filename"
                    class="recording-item"
                    :class="{ playing: isCurrentlyPlaying(rec) }"
                    @click="$emit('play', rec, idx)">
                    <span class="rec-icon">{{ isCurrentlyPlaying(rec) ? '&#9654;' : '&#9679;' }}</span>
                    <span class="rec-time">{{ formatDisplayTime(rec) }}</span>
                    <span class="rec-filename">{{ rec.filename }}</span>
                    <span class="rec-duration">{{ rec.audioDuration ? formatTime(rec.audioDuration) : '--:--' }}</span>
                </li>
            </ul>
        </div>
    </div>
</template>

<script>
import { t } from '../modules/i18n.js'
import { formatTime as formatTimeUtil, formatDuration } from '../modules/fileParser.js'

export default {
    name: 'RecordingList',
    props: {
        recordings: {
            type: Array,
            required: true
        },
        isCurrentlyPlaying: {
            type: Function,
            required: true
        }
    },
    emits: ['play'],
    setup() {
        function formatDisplayTime(rec) {
            return formatTimeUtil(rec.date)
        }

        function formatTime(seconds) {
            return formatDuration(seconds)
        }

        return {
            t,
            formatDisplayTime,
            formatTime
        }
    }
}
</script>
