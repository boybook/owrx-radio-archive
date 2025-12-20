/**
 * useTimeline - Timeline zoom and pan logic composable
 */
import { ref, computed } from 'vue'

const SECONDS_PER_DAY = 86400
const MAX_ZOOM = 1440  // 最大缩放到1分钟视图
const AUTO_FOLLOW_DELAY = 10000  // 10秒无操作后自动跟随

export function useTimeline() {
    // State
    const zoomLevel = ref(1)
    const viewStartTime = ref(0)
    const timelineRef = ref(null)
    const isDragging = ref(false)
    const dragStartX = ref(0)
    const dragStartViewTime = ref(0)
    const lastInteractionTime = ref(0)  // 最后一次用户交互时间

    // Touch gesture state
    let touchStartDistance = 0
    let touchStartZoom = 1
    let touchStartX = 0
    let touchStartViewTime = 0
    let isTouchZooming = false

    // Computed
    const viewEndTime = computed(() => {
        return viewStartTime.value + (SECONDS_PER_DAY / zoomLevel.value)
    })

    const visibleDuration = computed(() => {
        return SECONDS_PER_DAY / zoomLevel.value
    })

    const timelineTicks = computed(() => {
        const duration = visibleDuration.value
        const startTime = viewStartTime.value
        const endTime = viewEndTime.value

        let interval
        if (duration > 43200) {
            interval = 10800  // 3 hours
        } else if (duration > 21600) {
            interval = 3600   // 1 hour
        } else if (duration > 10800) {
            interval = 1800   // 30 minutes
        } else if (duration > 5400) {
            interval = 900    // 15 minutes
        } else if (duration > 1800) {
            interval = 300    // 5 minutes
        } else if (duration > 600) {
            interval = 120    // 2 minutes
        } else if (duration > 300) {
            interval = 60     // 1 minute
        } else if (duration > 120) {
            interval = 30     // 30 seconds
        } else if (duration > 60) {
            interval = 15     // 15 seconds
        } else {
            interval = 10     // 10 seconds
        }

        const ticks = []
        let tick = Math.ceil(startTime / interval) * interval

        while (tick <= endTime) {
            const hours = Math.floor(tick / 3600)
            const minutes = Math.floor((tick % 3600) / 60)

            let label
            if (interval >= 3600) {
                label = String(hours).padStart(2, '0')
            } else if (interval >= 60) {
                label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
            } else {
                const seconds = tick % 60
                label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            }

            const position = ((tick - startTime) / duration) * 100
            ticks.push({ time: tick, label, position })
            tick += interval
        }

        return ticks
    })

    const visibleDurationLabel = computed(() => {
        const totalSeconds = visibleDuration.value
        if (totalSeconds >= 3600) {
            const hours = Math.round(totalSeconds / 3600)
            return `${hours}h`
        } else if (totalSeconds >= 60) {
            const minutes = Math.round(totalSeconds / 60)
            return `${minutes}m`
        } else {
            return `${Math.round(totalSeconds)}s`
        }
    })

    // Methods
    function clampViewStart(value) {
        const maxStart = SECONDS_PER_DAY - visibleDuration.value
        return Math.max(0, Math.min(value, maxStart))
    }

    // 记录用户交互时间
    function recordInteraction() {
        lastInteractionTime.value = Date.now()
    }

    // 检查是否可以自动跟随
    function canAutoFollow() {
        return Date.now() - lastInteractionTime.value > AUTO_FOLLOW_DELAY
    }

    // 自动跟随播放头
    function autoFollowPlayhead(playheadTime) {
        if (!canAutoFollow()) return false

        const duration = visibleDuration.value
        const startTime = viewStartTime.value
        const endTime = viewEndTime.value

        // 播放头超出视图或超过视图 80% 位置时才自动跟随
        const isOutOfView = playheadTime < startTime || playheadTime > endTime
        const positionRatio = (playheadTime - startTime) / duration

        if (isOutOfView || positionRatio > 0.8) {
            // 使播放头在视图 1/5 位置
            const targetViewStart = playheadTime - duration * 0.2
            viewStartTime.value = clampViewStart(targetViewStart)
            return true
        }
        return false
    }

    function zoomAtPosition(newZoom, positionRatio) {
        const oldZoom = zoomLevel.value
        newZoom = Math.max(1, Math.min(MAX_ZOOM, newZoom))

        if (newZoom === oldZoom) return

        const centerTime = viewStartTime.value + visibleDuration.value * positionRatio
        zoomLevel.value = newZoom
        const newDuration = SECONDS_PER_DAY / newZoom
        viewStartTime.value = clampViewStart(centerTime - newDuration * positionRatio)
    }

    function zoomIn() {
        recordInteraction()
        zoomAtPosition(zoomLevel.value * 2, 0.5)
    }

    function zoomOut() {
        recordInteraction()
        zoomAtPosition(zoomLevel.value / 2, 0.5)
    }

    function resetZoom() {
        recordInteraction()
        zoomLevel.value = 1
        viewStartTime.value = 0
    }

    function handleWheel(e) {
        recordInteraction()
        const rect = e.currentTarget.getBoundingClientRect()

        if (e.ctrlKey) {
            // Ctrl+滚轮缩放（降低灵敏度）
            const positionRatio = (e.clientX - rect.left) / rect.width
            const zoomFactor = e.deltaY > 0 ? 0.975 : 1.025
            zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio)
            return
        }

        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            // 横向滚动平移时间轴
            const deltaTime = (e.deltaX / rect.width) * visibleDuration.value
            viewStartTime.value = clampViewStart(viewStartTime.value + deltaTime)
        } else {
            // 纵向滚动缩放（降低灵敏度）
            const positionRatio = (e.clientX - rect.left) / rect.width
            const zoomFactor = e.deltaY > 0 ? 0.975 : 1.025
            zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio)
        }
    }

    function handlePointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (e.target.closest('.timeline-segment')) return

        recordInteraction()
        isDragging.value = true
        dragStartX.value = e.clientX
        dragStartViewTime.value = viewStartTime.value
        e.currentTarget.setPointerCapture(e.pointerId)
    }

    function handlePointerMove(e) {
        if (!isDragging.value) return

        const rect = e.currentTarget.getBoundingClientRect()
        const deltaX = e.clientX - dragStartX.value
        const deltaTime = -(deltaX / rect.width) * visibleDuration.value

        viewStartTime.value = clampViewStart(dragStartViewTime.value + deltaTime)
    }

    function handlePointerUp(e) {
        if (isDragging.value) {
            isDragging.value = false
            if (e.currentTarget && e.pointerId !== undefined) {
                try {
                    e.currentTarget.releasePointerCapture(e.pointerId)
                } catch (err) { }
            }
        }
    }

    // Touch helpers
    function getTouchDistance(touches) {
        if (touches.length < 2) return 0
        const dx = touches[0].clientX - touches[1].clientX
        const dy = touches[0].clientY - touches[1].clientY
        return Math.sqrt(dx * dx + dy * dy)
    }

    function getTouchCenter(touches) {
        if (touches.length < 2) return touches[0]?.clientX || 0
        return (touches[0].clientX + touches[1].clientX) / 2
    }

    function handleTouchStart(e) {
        if (e.target.closest('.timeline-segment')) return

        recordInteraction()
        if (e.touches.length === 2) {
            isTouchZooming = true
            touchStartDistance = getTouchDistance(e.touches)
            touchStartZoom = zoomLevel.value
        } else if (e.touches.length === 1) {
            isTouchZooming = false
            touchStartX = e.touches[0].clientX
            touchStartViewTime = viewStartTime.value
        }
    }

    function handleTouchMove(e) {
        const rect = e.currentTarget.getBoundingClientRect()

        if (e.touches.length === 2 && isTouchZooming) {
            const currentDistance = getTouchDistance(e.touches)
            const scale = currentDistance / touchStartDistance
            const newZoom = Math.max(1, Math.min(MAX_ZOOM, touchStartZoom * scale))

            const centerX = getTouchCenter(e.touches)
            const positionRatio = (centerX - rect.left) / rect.width

            zoomAtPosition(newZoom, positionRatio)
        } else if (e.touches.length === 1 && !isTouchZooming) {
            const deltaX = e.touches[0].clientX - touchStartX
            const deltaTime = -(deltaX / rect.width) * visibleDuration.value
            viewStartTime.value = clampViewStart(touchStartViewTime + deltaTime)
        }
    }

    function handleTouchEnd(e) {
        if (e.touches.length === 0) {
            isTouchZooming = false
        } else if (e.touches.length === 1) {
            isTouchZooming = false
            touchStartX = e.touches[0].clientX
            touchStartViewTime = viewStartTime.value
        }
    }

    // Segment style calculation
    function getSubSegmentStyle(seg) {
        const dur = visibleDuration.value
        const startTime = viewStartTime.value
        const endTime = viewEndTime.value

        if (seg.end < startTime || seg.start > endTime) {
            return { display: 'none' }
        }

        const left = ((seg.start - startTime) / dur) * 100
        const width = Math.max(0.3, ((seg.end - seg.start) / dur) * 100)

        if (left < 0) {
            const clampedWidth = width + left
            if (clampedWidth <= 0.3) {
                return { display: 'none' }
            }
            return {
                left: '0%',
                width: `${clampedWidth}%`
            }
        }

        return {
            left: `${left}%`,
            width: `${width}%`
        }
    }

    // Playhead style calculation (original - for backwards compatibility)
    function getPlayheadStyle(currentTrack, currentTime) {
        if (!currentTrack) return { display: 'none' }

        const playheadTime = currentTrack.timeOfDay + currentTime
        return getPlayheadStyleByTime(playheadTime)
    }

    // Playhead style by absolute timeline time
    function getPlayheadStyleByTime(playheadTime) {
        const startTime = viewStartTime.value
        const endTime = viewEndTime.value

        if (playheadTime < startTime || playheadTime > endTime) {
            return { display: 'none' }
        }

        const left = ((playheadTime - startTime) / visibleDuration.value) * 100
        return { left: `${left}%` }
    }

    return {
        // State
        zoomLevel,
        viewStartTime,
        timelineRef,
        isDragging,
        lastInteractionTime,
        // Computed
        viewEndTime,
        visibleDuration,
        timelineTicks,
        visibleDurationLabel,
        // Methods
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
        getPlayheadStyleByTime,
        // Auto-follow
        recordInteraction,
        canAutoFollow,
        autoFollowPlayhead
    }
}

export default useTimeline
