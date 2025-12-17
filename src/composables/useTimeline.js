/**
 * useTimeline - Timeline zoom and pan logic composable
 */
import { ref, computed } from 'vue'

const SECONDS_PER_DAY = 86400
const MAX_ZOOM = 48

export function useTimeline() {
    // State
    const zoomLevel = ref(1)
    const viewStartTime = ref(0)
    const timelineRef = ref(null)
    const isDragging = ref(false)
    const dragStartX = ref(0)
    const dragStartViewTime = ref(0)

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
        } else {
            interval = 300    // 5 minutes
        }

        const ticks = []
        let tick = Math.ceil(startTime / interval) * interval

        while (tick <= endTime) {
            const hours = Math.floor(tick / 3600)
            const minutes = Math.floor((tick % 3600) / 60)

            let label
            if (interval >= 3600) {
                label = String(hours).padStart(2, '0')
            } else {
                label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
            }

            const position = ((tick - startTime) / duration) * 100
            ticks.push({ time: tick, label, position })
            tick += interval
        }

        return ticks
    })

    const visibleDurationLabel = computed(() => {
        const seconds = visibleDuration.value
        if (seconds >= 3600) {
            const hours = Math.round(seconds / 3600)
            return `${hours}h`
        } else {
            const minutes = Math.round(seconds / 60)
            return `${minutes}m`
        }
    })

    // Methods
    function clampViewStart(value) {
        const maxStart = SECONDS_PER_DAY - visibleDuration.value
        return Math.max(0, Math.min(value, maxStart))
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
        zoomAtPosition(zoomLevel.value * 2, 0.5)
    }

    function zoomOut() {
        zoomAtPosition(zoomLevel.value / 2, 0.5)
    }

    function resetZoom() {
        zoomLevel.value = 1
        viewStartTime.value = 0
    }

    function handleWheel(e) {
        const rect = e.currentTarget.getBoundingClientRect()

        if (e.ctrlKey) {
            const positionRatio = (e.clientX - rect.left) / rect.width
            const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05
            zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio)
            return
        }

        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const deltaTime = (e.deltaX / rect.width) * visibleDuration.value * 2
            viewStartTime.value = clampViewStart(viewStartTime.value + deltaTime)
        } else {
            const positionRatio = (e.clientX - rect.left) / rect.width
            const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05
            zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio)
        }
    }

    function handlePointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (e.target.closest('.timeline-segment')) return

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

    // Playhead style calculation
    function getPlayheadStyle(currentTrack, currentTime) {
        if (!currentTrack) return { display: 'none' }

        const playheadTime = currentTrack.timeOfDay + currentTime
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
        getPlayheadStyle
    }
}

export default useTimeline
