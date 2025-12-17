<template>
    <div class="radio-archive-section">
        <div class="radio-archive-section-label">
            {{ t('timeline') }}
            <span class="timeline-zoom-info">{{ visibleDurationLabel }}</span>
        </div>
        <div class="timeline-wrapper">
            <div class="timeline-container"
                @wheel.prevent="handleWheel"
                @pointerdown="handlePointerDown"
                @pointermove="handlePointerMove"
                @pointerup="handlePointerUp"
                @pointerleave="handlePointerUp"
                @touchstart="handleTouchStart"
                @touchmove.prevent="handleTouchMove"
                @touchend="handleTouchEnd"
                :class="{ dragging: isDragging }">
                <div class="timeline-hours">
                    <span
                        v-for="tick in timelineTicks"
                        :key="tick.time"
                        class="timeline-tick"
                        :style="{ left: tick.position + '%' }">
                        {{ tick.label }}
                    </span>
                </div>
                <div class="timeline-track" ref="timelineRef">
                    <template v-for="rec in timelineRecordings" :key="rec.filename + (rec.isCrossDay ? '-crossday' : '')">
                        <!-- Base layer: full duration -->
                        <div
                            class="timeline-segment base"
                            :class="{ playing: isCurrentlyPlaying(rec) }"
                            :style="getSubSegmentStyle(getRecordingBaseSegment(rec))"
                            :title="formatSegmentTitle(getRecordingBaseSegment(rec))"
                            @click.stop="$emit('play', rec, 0)">
                        </div>
                        <!-- Active layer: non-silence segments -->
                        <div
                            v-for="(seg, segIdx) in getRecordingActiveSegments(rec)"
                            :key="rec.filename + '-active-' + segIdx"
                            class="timeline-segment active"
                            :class="{ playing: isCurrentlyPlaying(rec) }"
                            :style="getSubSegmentStyle(seg)"
                            :title="formatSegmentTitle(seg)"
                            @click.stop="$emit('play', seg.recording, seg.audioStart)">
                        </div>
                    </template>
                    <div
                        class="timeline-playhead"
                        :style="playheadStyle"
                        v-if="currentTrack">
                    </div>
                </div>
            </div>
            <div class="timeline-controls">
                <button class="timeline-ctrl-btn" @click="zoomIn" :disabled="zoomLevel >= 48" :title="t('zoomIn')">+</button>
                <button class="timeline-ctrl-btn" @click="zoomOut" :disabled="zoomLevel <= 1" :title="t('zoomOut')">−</button>
                <button class="timeline-ctrl-btn" @click="resetZoom" :disabled="zoomLevel === 1" :title="t('reset')">↺</button>
            </div>
        </div>
    </div>
</template>

<script>
import { computed } from 'vue'
import { t } from '../modules/i18n.js'
import { formatTime, formatDuration } from '../modules/fileParser.js'

export default {
    name: 'Timeline',
    props: {
        timelineRecordings: {
            type: Array,
            required: true
        },
        currentTrack: {
            type: Object,
            default: null
        },
        currentTime: {
            type: Number,
            default: 0
        },
        // Timeline state from useTimeline
        zoomLevel: {
            type: Number,
            default: 1
        },
        isDragging: {
            type: Boolean,
            default: false
        },
        timelineTicks: {
            type: Array,
            default: () => []
        },
        visibleDurationLabel: {
            type: String,
            default: '24h'
        },
        // Methods passed from parent
        getSubSegmentStyle: {
            type: Function,
            required: true
        },
        getRecordingBaseSegment: {
            type: Function,
            required: true
        },
        getRecordingActiveSegments: {
            type: Function,
            required: true
        },
        isCurrentlyPlaying: {
            type: Function,
            required: true
        },
        getPlayheadStyle: {
            type: Function,
            required: true
        },
        // Timeline handlers
        handleWheel: {
            type: Function,
            required: true
        },
        handlePointerDown: {
            type: Function,
            required: true
        },
        handlePointerMove: {
            type: Function,
            required: true
        },
        handlePointerUp: {
            type: Function,
            required: true
        },
        handleTouchStart: {
            type: Function,
            required: true
        },
        handleTouchMove: {
            type: Function,
            required: true
        },
        handleTouchEnd: {
            type: Function,
            required: true
        },
        zoomIn: {
            type: Function,
            required: true
        },
        zoomOut: {
            type: Function,
            required: true
        },
        resetZoom: {
            type: Function,
            required: true
        }
    },
    emits: ['play'],
    setup(props) {
        const playheadStyle = computed(() => {
            return props.getPlayheadStyle(props.currentTrack, props.currentTime)
        })

        function formatSegmentTitle(seg) {
            const startTime = new Date(seg.recording.date.getTime() + seg.audioStart * 1000)
            const timeStr = formatTime(startTime)
            const durationStr = formatDuration(seg.audioEnd - seg.audioStart)
            return `${timeStr} (${durationStr})`
        }

        return {
            t,
            playheadStyle,
            formatSegmentTitle
        }
    }
}
</script>
