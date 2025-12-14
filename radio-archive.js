/**
 * Radio Archive - Timeline Audio Player for OpenWebRX+
 * A Vue 3 application for browsing and playing recorded audio files
 */

(function () {
    'use strict';

    console.log('[RadioArchive] Script loaded');
    console.log('[RadioArchive] Current pathname:', location.pathname);

    // Only run on /files page
    if (!location.pathname.endsWith('/files') && !location.pathname.endsWith('/files/')) {
        console.log('[RadioArchive] Not on /files page, exiting');
        return;
    }

    console.log('[RadioArchive] On /files page, initializing...');

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'static/plugins/receiver/radio-archive/radio-archive.css';
    document.head.appendChild(link);
    console.log('[RadioArchive] CSS link added');

    // Wait for Vue to be available
    function waitForVue(timeout = 5000) {
        console.log('[RadioArchive] Waiting for Vue...');
        console.log('[RadioArchive] window.Vue =', window.Vue);

        return new Promise((resolve, reject) => {
            if (window.Vue) {
                console.log('[RadioArchive] Vue already available');
                return resolve(window.Vue);
            }

            const start = Date.now();
            const check = setInterval(() => {
                if (window.Vue) {
                    clearInterval(check);
                    console.log('[RadioArchive] Vue loaded after', Date.now() - start, 'ms');
                    resolve(window.Vue);
                } else if (Date.now() - start > timeout) {
                    clearInterval(check);
                    console.error('[RadioArchive] Vue load timeout after', timeout, 'ms');
                    reject(new Error('Vue not loaded'));
                }
            }, 50);
        });
    }

    // ==========================================
    // File Parser - Parse REC-YYMMDD-HHMMSS-FREQ.mp3
    // ==========================================
    const FileParser = {
        // Pattern: REC-251214-100246-145280.mp3
        PATTERN: /^REC-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d+)\.mp3$/i,

        parse(filename) {
            const match = filename.match(this.PATTERN);
            if (!match) return null;

            const [, yy, mm, dd, hh, min, ss, freq] = match;
            const year = 2000 + parseInt(yy, 10);
            const month = parseInt(mm, 10) - 1;
            const day = parseInt(dd, 10);
            const hours = parseInt(hh, 10);
            const minutes = parseInt(min, 10);
            const seconds = parseInt(ss, 10);
            const frequency = parseInt(freq, 10);

            const date = new Date(year, month, day, hours, minutes, seconds);
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            return {
                filename,
                date,
                dateKey,
                hours,
                minutes,
                seconds,
                frequency,
                freqMHz: frequency / 1000,
                timeOfDay: hours * 3600 + minutes * 60 + seconds,
                href: `files/${filename}`,
                audioDuration: null  // Initialize for Vue reactivity
            };
        },

        formatFreq(freqHz) {
            const mhz = freqHz / 1000;
            return mhz.toFixed(3) + ' MHz';
        },

        formatTime(date) {
            return date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        },

        formatDuration(seconds) {
            if (!seconds || !isFinite(seconds)) return '--:--';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${String(s).padStart(2, '0')}`;
        }
    };

    // ==========================================
    // Initialize Vue App
    // ==========================================

    function init() {
        console.log('[RadioArchive] init() called, DOM state:', document.readyState);
        console.log('[RadioArchive] Calling waitForVue()...');

        waitForVue().then((Vue) => {
        console.log('[RadioArchive] Vue ready, creating app...');
        console.log('[RadioArchive] Vue version:', Vue.version);

        const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

        const app = createApp({
            setup() {
                // ==========================================
                // State
                // ==========================================
                const recordings = ref([]);
                const selectedDate = ref(null);
                const selectedFreq = ref(null);
                const activeView = ref('timeline'); // 'original' | 'timeline'

                // Player state
                const audio = ref(null);
                const currentTrack = ref(null);
                const currentIndex = ref(-1);
                const isPlaying = ref(false);
                const currentTime = ref(0);
                const duration = ref(0);
                const volume = ref(1);
                const playbackRate = ref(1);
                const continuousPlay = ref(true);

                // ==========================================
                // Computed
                // ==========================================

                // All unique dates with recordings
                const availableDates = computed(() => {
                    const dates = [...new Set(recordings.value.map(r => r.dateKey))];
                    return dates.sort();
                });

                // All unique frequencies
                const availableFreqs = computed(() => {
                    const freqs = [...new Set(recordings.value.map(r => r.frequency))];
                    return freqs.sort((a, b) => a - b);
                });

                // Frequency stats for selected date
                const freqStats = computed(() => {
                    if (!selectedDate.value) return {};
                    const stats = {};
                    recordings.value
                        .filter(r => r.dateKey === selectedDate.value)
                        .forEach(r => {
                            stats[r.frequency] = (stats[r.frequency] || 0) + 1;
                        });
                    return stats;
                });

                // Filtered recordings by date and frequency
                const filteredRecordings = computed(() => {
                    return recordings.value
                        .filter(r => {
                            if (selectedDate.value && r.dateKey !== selectedDate.value) return false;
                            if (selectedFreq.value && r.frequency !== selectedFreq.value) return false;
                            return true;
                        })
                        .sort((a, b) => a.date - b.date);
                });

                // For timeline positioning
                const SECONDS_PER_DAY = 86400;
                const MAX_ZOOM = 48;  // 最大缩放48倍（显示30分钟）

                // ==========================================
                // Timeline Zoom & Pan State
                // ==========================================
                const zoomLevel = ref(1);        // 1 = 完整24小时
                const viewStartTime = ref(0);    // 可视窗口起始时间（秒）
                const timelineRef = ref(null);   // timeline-track DOM引用
                const isDragging = ref(false);   // 拖拽状态
                const dragStartX = ref(0);       // 拖拽起始位置
                const dragStartViewTime = ref(0); // 拖拽起始时的viewStartTime

                // 可视窗口结束时间
                const viewEndTime = computed(() => {
                    return viewStartTime.value + (SECONDS_PER_DAY / zoomLevel.value);
                });

                // 可视时长（秒）
                const visibleDuration = computed(() => {
                    return SECONDS_PER_DAY / zoomLevel.value;
                });

                // 动态时间刻度
                const timelineTicks = computed(() => {
                    const duration = visibleDuration.value;
                    const startTime = viewStartTime.value;
                    const endTime = viewEndTime.value;

                    // 根据可视时长决定刻度间隔
                    let interval;
                    if (duration > 43200) {         // > 12小时: 3小时间隔
                        interval = 10800;  // 3小时
                    } else if (duration > 21600) {  // > 6小时: 1小时间隔
                        interval = 3600;   // 1小时
                    } else if (duration > 10800) {  // > 3小时: 30分钟间隔
                        interval = 1800;   // 30分钟
                    } else if (duration > 5400) {   // > 1.5小时: 15分钟间隔
                        interval = 900;    // 15分钟
                    } else {                        // <= 1.5小时: 5分钟间隔
                        interval = 300;    // 5分钟
                    }

                    const ticks = [];
                    // 找到第一个刻度（向下取整到interval）
                    let tick = Math.ceil(startTime / interval) * interval;

                    while (tick <= endTime) {
                        const hours = Math.floor(tick / 3600);
                        const minutes = Math.floor((tick % 3600) / 60);

                        // 格式化标签
                        let label;
                        if (interval >= 3600) {
                            // 整小时只显示小时
                            label = String(hours).padStart(2, '0');
                        } else {
                            // 显示 HH:MM
                            label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                        }

                        // 计算位置百分比
                        const position = ((tick - startTime) / duration) * 100;

                        ticks.push({ time: tick, label, position });
                        tick += interval;
                    }

                    return ticks;
                });

                // 格式化可视时长显示
                const visibleDurationLabel = computed(() => {
                    const seconds = visibleDuration.value;
                    if (seconds >= 3600) {
                        const hours = Math.round(seconds / 3600);
                        return `${hours}h`;
                    } else {
                        const minutes = Math.round(seconds / 60);
                        return `${minutes}m`;
                    }
                });

                // Preload state
                const isPreloading = ref(false);
                const preloadProgress = ref(0);

                // ==========================================
                // Preload Functions
                // ==========================================

                // Preload single recording duration
                function preloadDuration(recording) {
                    return new Promise((resolve) => {
                        // Skip if already loaded (caching)
                        if (recording.audioDuration && isFinite(recording.audioDuration)) {
                            console.log('[RadioArchive] Using cached duration for', recording.filename, ':', recording.audioDuration);
                            resolve();
                            return;
                        }

                        const tempAudio = new Audio();
                        // Use 'auto' instead of 'metadata' to load enough data for duration
                        tempAudio.preload = 'auto';

                        let resolved = false;

                        const cleanup = () => {
                            tempAudio.removeEventListener('durationchange', onDurationChange);
                            tempAudio.removeEventListener('error', onError);
                            tempAudio.pause();
                            // Don't set src = '' - it causes "Invalid URI" errors
                        };

                        // Use durationchange event instead of loadedmetadata
                        // loadedmetadata may return Infinity for chunked transfer encoding
                        const onDurationChange = () => {
                            console.log('[RadioArchive] durationchange for', recording.filename, 'duration:', tempAudio.duration);
                            // Only process when duration is finite and positive
                            if (isFinite(tempAudio.duration) && tempAudio.duration > 0) {
                                if (resolved) return;
                                resolved = true;

                                // Find and replace in array to trigger Vue reactivity
                                const index = recordings.value.findIndex(r => r.filename === recording.filename);
                                if (index !== -1) {
                                    recordings.value[index] = {
                                        ...recordings.value[index],
                                        audioDuration: tempAudio.duration
                                    };
                                }
                                console.log('[RadioArchive] Loaded duration for', recording.filename, ':', tempAudio.duration);
                                cleanup();
                                resolve();
                            }
                        };

                        const onError = (e) => {
                            console.log('[RadioArchive] onError fired for', recording.filename, e);
                            if (resolved) return;
                            resolved = true;
                            console.warn('[RadioArchive] Failed to load metadata for', recording.filename);
                            cleanup();
                            resolve();
                        };

                        tempAudio.addEventListener('durationchange', onDurationChange);
                        tempAudio.addEventListener('error', onError);

                        // Timeout protection
                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                console.warn('[RadioArchive] Timeout loading metadata for', recording.filename);
                                cleanup();
                                resolve();
                            }
                        }, 5000);

                        tempAudio.src = recording.href;
                        tempAudio.load();  // Force browser to start loading
                        console.log('[RadioArchive] Started preload for', recording.filename);
                    });
                }

                // Batch preload current filtered recordings
                async function preloadCurrentRecordings() {
                    const toPreload = filteredRecordings.value.filter(
                        r => !r.audioDuration || !isFinite(r.audioDuration)
                    );

                    if (toPreload.length === 0) {
                        console.log('[RadioArchive] All recordings already preloaded');
                        return;
                    }

                    console.log('[RadioArchive] Preloading', toPreload.length, 'recordings...');
                    isPreloading.value = true;
                    preloadProgress.value = 0;

                    const BATCH_SIZE = 3;
                    let loaded = 0;

                    for (let i = 0; i < toPreload.length; i += BATCH_SIZE) {
                        const batch = toPreload.slice(i, i + BATCH_SIZE);
                        await Promise.all(batch.map(preloadDuration));
                        loaded += batch.length;
                        preloadProgress.value = Math.round((loaded / toPreload.length) * 100);
                    }

                    isPreloading.value = false;
                    console.log('[RadioArchive] Preload complete');
                    // Note: No need for deep copy here - each preload updates the array element individually
                }

                // ==========================================
                // Methods
                // ==========================================

                function parseFilesFromDOM() {
                    console.log('[RadioArchive] parseFilesFromDOM called');

                    const fileTiles = document.querySelectorAll('.file-tile');
                    console.log('[RadioArchive] Found .file-tile elements:', fileTiles.length);

                    const fileLinks = document.querySelectorAll('.file-tile a[href^="files/"]');
                    console.log('[RadioArchive] Found file links:', fileLinks.length);

                    const files = [];
                    fileLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        const filename = href.replace('files/', '');
                        console.log('[RadioArchive] Processing file:', filename);

                        const parsed = FileParser.parse(filename);
                        if (parsed) {
                            console.log('[RadioArchive] Parsed:', parsed);
                            files.push(parsed);
                        } else {
                            console.log('[RadioArchive] Could not parse:', filename);
                        }
                    });

                    recordings.value = files;
                    console.log('[RadioArchive] Total recordings:', files.length);

                    // Set initial selection
                    if (availableDates.value.length > 0) {
                        selectedDate.value = availableDates.value[availableDates.value.length - 1];
                        console.log('[RadioArchive] Selected date:', selectedDate.value);
                    }
                    if (availableFreqs.value.length > 0) {
                        selectedFreq.value = availableFreqs.value[0];
                        console.log('[RadioArchive] Selected freq:', selectedFreq.value);
                    }
                }

                function switchView(view) {
                    activeView.value = view;
                }

                function selectDate(dateKey) {
                    selectedDate.value = dateKey;
                }

                function selectFreq(freq) {
                    selectedFreq.value = freq;
                }

                function prevDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    if (idx > 0) {
                        selectedDate.value = availableDates.value[idx - 1];
                    }
                }

                function nextDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    if (idx < availableDates.value.length - 1) {
                        selectedDate.value = availableDates.value[idx + 1];
                    }
                }

                function canPrevDate() {
                    return availableDates.value.indexOf(selectedDate.value) > 0;
                }

                function canNextDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    return idx < availableDates.value.length - 1;
                }

                // Timeline segment position (支持缩放)
                function getSegmentStyle(rec) {
                    const duration = visibleDuration.value;
                    const startTime = viewStartTime.value;
                    const endTime = viewEndTime.value;

                    // 计算录音在可视窗口中的位置
                    const recStart = rec.timeOfDay;
                    const actualDuration = (rec.audioDuration && isFinite(rec.audioDuration))
                        ? rec.audioDuration
                        : 60;
                    const recEnd = recStart + actualDuration;

                    // 如果录音完全在可视范围外，隐藏
                    if (recEnd < startTime || recStart > endTime) {
                        return { display: 'none' };
                    }

                    // 计算相对于可视窗口的位置
                    const left = ((recStart - startTime) / duration) * 100;
                    const width = Math.max(0.3, (actualDuration / duration) * 100);

                    return {
                        left: `${left}%`,
                        width: `${width}%`
                    };
                }

                // Audio control
                function play(recording, index) {
                    if (!audio.value) {
                        audio.value = new Audio();
                        audio.value.addEventListener('timeupdate', onTimeUpdate);
                        audio.value.addEventListener('loadedmetadata', onLoadedMetadata);
                        audio.value.addEventListener('durationchange', onDurationChange);
                        audio.value.addEventListener('ended', onEnded);
                        audio.value.addEventListener('play', () => isPlaying.value = true);
                        audio.value.addEventListener('pause', () => isPlaying.value = false);
                    }

                    if (currentTrack.value?.filename === recording.filename) {
                        // Toggle play/pause
                        if (isPlaying.value) {
                            audio.value.pause();
                        } else {
                            audio.value.play();
                        }
                        return;
                    }

                    currentTrack.value = recording;
                    currentIndex.value = index !== undefined ? index : filteredRecordings.value.indexOf(recording);

                    // Use preloaded duration if available
                    if (recording.audioDuration && isFinite(recording.audioDuration)) {
                        duration.value = recording.audioDuration;
                        console.log('[RadioArchive] Using preloaded duration:', duration.value);
                    } else {
                        duration.value = 0;
                    }

                    audio.value.src = recording.href;
                    audio.value.volume = volume.value;
                    audio.value.playbackRate = playbackRate.value;
                    audio.value.play();
                }

                function togglePlay() {
                    if (!audio.value) return;
                    if (isPlaying.value) {
                        audio.value.pause();
                    } else {
                        audio.value.play();
                    }
                }

                function playPrev() {
                    if (currentIndex.value > 0) {
                        const idx = currentIndex.value - 1;
                        play(filteredRecordings.value[idx], idx);
                    }
                }

                function playNext() {
                    if (currentIndex.value < filteredRecordings.value.length - 1) {
                        const idx = currentIndex.value + 1;
                        play(filteredRecordings.value[idx], idx);
                    }
                }

                function seek(e) {
                    // Check if duration is valid
                    if (!audio.value || !duration.value || !isFinite(duration.value)) {
                        console.log('[RadioArchive] Cannot seek: duration not available');
                        return;
                    }
                    const percent = e.target.value / 100;
                    const newTime = percent * duration.value;
                    if (isFinite(newTime)) {
                        audio.value.currentTime = newTime;
                    }
                }

                function setVolume(e) {
                    volume.value = e.target.value / 100;
                    if (audio.value) {
                        audio.value.volume = volume.value;
                    }
                }

                function setSpeed(e) {
                    playbackRate.value = parseFloat(e.target.value);
                    if (audio.value) {
                        audio.value.playbackRate = playbackRate.value;
                    }
                }

                function onTimeUpdate() {
                    currentTime.value = audio.value.currentTime;
                }

                function onLoadedMetadata() {
                    if (isFinite(audio.value.duration)) {
                        duration.value = audio.value.duration;
                        // Also update the recording object
                        if (currentTrack.value) {
                            currentTrack.value.audioDuration = audio.value.duration;
                        }
                    }
                }

                function onDurationChange() {
                    if (isFinite(audio.value.duration)) {
                        duration.value = audio.value.duration;
                        console.log('[RadioArchive] Duration changed:', duration.value);
                    }
                }

                function onEnded() {
                    if (continuousPlay.value && currentIndex.value < filteredRecordings.value.length - 1) {
                        playNext();
                    } else {
                        isPlaying.value = false;
                    }
                }

                function formatTime(seconds) {
                    return FileParser.formatDuration(seconds);
                }

                function formatFreq(freq) {
                    return FileParser.formatFreq(freq);
                }

                function formatDisplayTime(rec) {
                    return FileParser.formatTime(rec.date);
                }

                function getProgressPercent() {
                    if (!duration.value) return 0;
                    return (currentTime.value / duration.value) * 100;
                }

                function isCurrentlyPlaying(rec) {
                    return currentTrack.value?.filename === rec.filename;
                }

                // Playhead position on timeline (支持缩放)
                function getPlayheadStyle() {
                    if (!currentTrack.value) return { display: 'none' };

                    const trackTime = currentTrack.value.timeOfDay;
                    const startTime = viewStartTime.value;
                    const endTime = viewEndTime.value;

                    // 如果播放头在可视范围外，隐藏
                    if (trackTime < startTime || trackTime > endTime) {
                        return { display: 'none' };
                    }

                    const left = ((trackTime - startTime) / visibleDuration.value) * 100;
                    return { left: `${left}%` };
                }

                // ==========================================
                // Timeline Zoom & Pan Functions
                // ==========================================

                // 限制 viewStartTime 在有效范围内
                function clampViewStart(value) {
                    const maxStart = SECONDS_PER_DAY - visibleDuration.value;
                    return Math.max(0, Math.min(value, maxStart));
                }

                // 缩放：以指定位置为中心
                function zoomAtPosition(newZoom, positionRatio) {
                    const oldZoom = zoomLevel.value;
                    newZoom = Math.max(1, Math.min(MAX_ZOOM, newZoom));

                    if (newZoom === oldZoom) return;

                    // 计算缩放中心点的时间
                    const centerTime = viewStartTime.value + visibleDuration.value * positionRatio;

                    // 更新缩放级别
                    zoomLevel.value = newZoom;

                    // 计算新的 viewStartTime，保持中心点不变
                    const newDuration = SECONDS_PER_DAY / newZoom;
                    viewStartTime.value = clampViewStart(centerTime - newDuration * positionRatio);
                }

                // 按钮：放大
                function zoomIn() {
                    zoomAtPosition(zoomLevel.value * 2, 0.5);
                }

                // 按钮：缩小
                function zoomOut() {
                    zoomAtPosition(zoomLevel.value / 2, 0.5);
                }

                // 按钮：重置
                function resetZoom() {
                    zoomLevel.value = 1;
                    viewStartTime.value = 0;
                }

                // 鼠标滚轮/触摸板缩放
                function handleWheel(e) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const positionRatio = (e.clientX - rect.left) / rect.width;

                    // 触摸板双指捏合会触发 ctrlKey
                    // 普通滚轮也支持缩放
                    const delta = e.deltaY || e.deltaX;
                    const zoomFactor = delta > 0 ? 0.9 : 1.1;
                    zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio);
                }

                // 拖拽平移：开始
                function handlePointerDown(e) {
                    // 只响应鼠标左键或触摸
                    if (e.pointerType === 'mouse' && e.button !== 0) return;

                    isDragging.value = true;
                    dragStartX.value = e.clientX;
                    dragStartViewTime.value = viewStartTime.value;
                    e.currentTarget.setPointerCapture(e.pointerId);
                }

                // 拖拽平移：移动
                function handlePointerMove(e) {
                    if (!isDragging.value) return;

                    const rect = e.currentTarget.getBoundingClientRect();
                    const deltaX = e.clientX - dragStartX.value;
                    const deltaTime = -(deltaX / rect.width) * visibleDuration.value;

                    viewStartTime.value = clampViewStart(dragStartViewTime.value + deltaTime);
                }

                // 拖拽平移：结束
                function handlePointerUp(e) {
                    if (isDragging.value) {
                        isDragging.value = false;
                        if (e.currentTarget && e.pointerId !== undefined) {
                            try {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                            } catch (err) {
                                // 忽略
                            }
                        }
                    }
                }

                // ==========================================
                // Mobile Touch Gestures
                // ==========================================
                let touchStartDistance = 0;
                let touchStartZoom = 1;
                let touchStartX = 0;
                let touchStartViewTime = 0;
                let isTouchZooming = false;

                function getTouchDistance(touches) {
                    if (touches.length < 2) return 0;
                    const dx = touches[0].clientX - touches[1].clientX;
                    const dy = touches[0].clientY - touches[1].clientY;
                    return Math.sqrt(dx * dx + dy * dy);
                }

                function getTouchCenter(touches) {
                    if (touches.length < 2) return touches[0]?.clientX || 0;
                    return (touches[0].clientX + touches[1].clientX) / 2;
                }

                function handleTouchStart(e) {
                    if (e.touches.length === 2) {
                        // 双指：缩放
                        isTouchZooming = true;
                        touchStartDistance = getTouchDistance(e.touches);
                        touchStartZoom = zoomLevel.value;
                    } else if (e.touches.length === 1) {
                        // 单指：拖拽
                        isTouchZooming = false;
                        touchStartX = e.touches[0].clientX;
                        touchStartViewTime = viewStartTime.value;
                    }
                }

                function handleTouchMove(e) {
                    const rect = e.currentTarget.getBoundingClientRect();

                    if (e.touches.length === 2 && isTouchZooming) {
                        // 双指缩放
                        const currentDistance = getTouchDistance(e.touches);
                        const scale = currentDistance / touchStartDistance;
                        const newZoom = Math.max(1, Math.min(MAX_ZOOM, touchStartZoom * scale));

                        const centerX = getTouchCenter(e.touches);
                        const positionRatio = (centerX - rect.left) / rect.width;

                        zoomAtPosition(newZoom, positionRatio);
                    } else if (e.touches.length === 1 && !isTouchZooming) {
                        // 单指拖拽
                        const deltaX = e.touches[0].clientX - touchStartX;
                        const deltaTime = -(deltaX / rect.width) * visibleDuration.value;
                        viewStartTime.value = clampViewStart(touchStartViewTime + deltaTime);
                    }
                }

                function handleTouchEnd(e) {
                    if (e.touches.length === 0) {
                        isTouchZooming = false;
                    } else if (e.touches.length === 1) {
                        // 从双指变成单指，重新开始拖拽
                        isTouchZooming = false;
                        touchStartX = e.touches[0].clientX;
                        touchStartViewTime = viewStartTime.value;
                    }
                }

                // ==========================================
                // Inject UI
                // ==========================================
                function injectUI() {
                    const container = document.querySelector('.container');
                    if (!container) return;

                    const h1 = container.querySelector('h1');
                    const table = container.querySelector('table');
                    if (!h1 || !table) return;

                    // Create Vue mount point
                    const appContainer = document.createElement('div');
                    appContainer.id = 'radio-archive-app';
                    h1.after(appContainer);

                    // Remove the original h1 title
                    h1.remove();

                    // Wrap original table (not active by default since we default to timeline view)
                    const originalView = document.createElement('div');
                    originalView.id = 'original-files-view';
                    originalView.className = 'radio-archive-view';
                    table.parentNode.insertBefore(originalView, table);
                    originalView.appendChild(table);
                }

                // Watch for view changes to toggle original table
                watch(activeView, (newView) => {
                    const originalView = document.getElementById('original-files-view');
                    if (originalView) {
                        originalView.classList.toggle('active', newView === 'original');
                    }
                });

                // Watch for date/freq changes to trigger preload
                watch([selectedDate, selectedFreq], () => {
                    console.log('[RadioArchive] Selection changed, triggering preload');
                    nextTick(() => {
                        preloadCurrentRecordings();
                    });
                });

                // Keyboard shortcut handler
                function handleKeydown(e) {
                    // Only handle when not typing in an input
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                        return;
                    }

                    // Spacebar to toggle play/pause
                    if (e.code === 'Space') {
                        e.preventDefault(); // Prevent page scroll
                        togglePlay();
                    }

                    // Left arrow: rewind 5 seconds
                    if (e.code === 'ArrowLeft') {
                        e.preventDefault();
                        if (audio.value) {
                            audio.value.currentTime = Math.max(0, audio.value.currentTime - 5);
                        }
                    }

                    // Right arrow: forward 5 seconds
                    if (e.code === 'ArrowRight') {
                        e.preventDefault();
                        if (audio.value && duration.value) {
                            audio.value.currentTime = Math.min(duration.value, audio.value.currentTime + 5);
                        }
                    }
                }

                onMounted(() => {
                    nextTick(() => {
                        parseFilesFromDOM();
                        // Initial preload after parsing
                        nextTick(() => {
                            preloadCurrentRecordings();
                        });
                    });

                    // Add keyboard listener
                    document.addEventListener('keydown', handleKeydown);
                });

                onUnmounted(() => {
                    // Remove keyboard listener
                    document.removeEventListener('keydown', handleKeydown);
                });

                return {
                    // State
                    recordings,
                    selectedDate,
                    selectedFreq,
                    activeView,
                    currentTrack,
                    isPlaying,
                    currentTime,
                    duration,
                    volume,
                    playbackRate,
                    continuousPlay,
                    isPreloading,
                    preloadProgress,
                    // Timeline Zoom State
                    zoomLevel,
                    viewStartTime,
                    timelineRef,
                    isDragging,
                    // Computed
                    availableDates,
                    availableFreqs,
                    freqStats,
                    filteredRecordings,
                    timelineTicks,
                    visibleDurationLabel,
                    // Methods
                    switchView,
                    selectDate,
                    selectFreq,
                    prevDate,
                    nextDate,
                    canPrevDate,
                    canNextDate,
                    getSegmentStyle,
                    play,
                    togglePlay,
                    playPrev,
                    playNext,
                    seek,
                    setVolume,
                    setSpeed,
                    formatTime,
                    formatFreq,
                    formatDisplayTime,
                    getProgressPercent,
                    isCurrentlyPlaying,
                    getPlayheadStyle,
                    // Timeline Zoom Methods
                    zoomIn,
                    zoomOut,
                    resetZoom,
                    handleWheel,
                    handlePointerDown,
                    handlePointerMove,
                    handlePointerUp,
                    handleTouchStart,
                    handleTouchMove,
                    handleTouchEnd
                };
            },

            template: `
                <div class="radio-archive-wrapper">
                    <!-- Tab Bar -->
                    <div class="radio-archive-tabs">
                        <button
                            class="tab-btn"
                            :class="{ active: activeView === 'original' }"
                            @click="switchView('original')">
                            Received Files
                        </button>
                        <button
                            class="tab-btn"
                            :class="{ active: activeView === 'timeline' }"
                            @click="switchView('timeline')">
                            Radio Archive
                        </button>
                    </div>

                    <!-- Timeline View -->
                    <div class="radio-archive-view" :class="{ active: activeView === 'timeline' }">
                        <div class="radio-archive" v-if="recordings.length > 0">

                            <!-- Frequency Selector -->
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">Frequency</div>
                                <div class="frequency-list">
                                    <div
                                        v-for="freq in availableFreqs"
                                        :key="freq"
                                        class="frequency-item"
                                        :class="{ selected: selectedFreq === freq }"
                                        @click="selectFreq(freq)">
                                        <span class="freq-name">{{ formatFreq(freq) }}</span>
                                        <span class="freq-count" v-if="freqStats[freq]">{{ freqStats[freq] }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Date Selector -->
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">Date</div>
                                <div class="date-selector">
                                    <button class="date-btn" @click="prevDate" :disabled="!canPrevDate()">&#8249;</button>
                                    <input
                                        type="date"
                                        class="date-input"
                                        :value="selectedDate"
                                        @change="selectDate($event.target.value)">
                                    <button class="date-btn" @click="nextDate" :disabled="!canNextDate()">&#8250;</button>
                                </div>
                            </div>

                            <!-- Timeline -->
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">
                                    Timeline
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
                                            <div
                                                v-for="(rec, idx) in filteredRecordings"
                                                :key="rec.filename"
                                                class="timeline-segment"
                                                :class="{ playing: isCurrentlyPlaying(rec) }"
                                                :style="getSegmentStyle(rec)"
                                                :title="formatDisplayTime(rec)"
                                                @click.stop="play(rec, idx)">
                                            </div>
                                            <div
                                                class="timeline-playhead"
                                                :style="getPlayheadStyle()"
                                                v-if="currentTrack">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="timeline-controls">
                                        <button class="timeline-ctrl-btn" @click="zoomIn" :disabled="zoomLevel >= 48" title="放大">+</button>
                                        <button class="timeline-ctrl-btn" @click="zoomOut" :disabled="zoomLevel <= 1" title="缩小">−</button>
                                        <button class="timeline-ctrl-btn" @click="resetZoom" :disabled="zoomLevel === 1" title="重置">↺</button>
                                    </div>
                                </div>
                            </div>

                            <!-- Player -->
                            <div class="radio-archive-section">
                                <div class="player-container">
                                    <div class="player-now-playing">
                                        <span class="player-track-name">
                                            {{ currentTrack ? formatDisplayTime(currentTrack) + ' - ' + formatFreq(currentTrack.frequency) : 'No track selected' }}
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
                                        :value="getProgressPercent()"
                                        @input="seek"
                                        :style="{ '--progress': getProgressPercent() + '%' }">

                                    <div class="player-controls">
                                        <button class="player-btn" @click="playPrev" :disabled="!currentTrack">&#9198;</button>
                                        <button class="player-btn play-btn" @click="togglePlay" :disabled="!currentTrack">
                                            {{ isPlaying ? '&#10074;&#10074;' : '&#9654;' }}
                                        </button>
                                        <button class="player-btn" @click="playNext" :disabled="!currentTrack">&#9197;</button>

                                        <div class="player-spacer"></div>

                                        <div class="player-volume">
                                            <span>&#128266;</span>
                                            <input
                                                type="range"
                                                class="volume-slider"
                                                min="0"
                                                max="100"
                                                :value="volume * 100"
                                                @input="setVolume">
                                        </div>

                                        <select class="speed-select" :value="playbackRate" @change="setSpeed">
                                            <option value="0.5">0.5x</option>
                                            <option value="0.75">0.75x</option>
                                            <option value="1">1.0x</option>
                                            <option value="1.25">1.25x</option>
                                            <option value="1.5">1.5x</option>
                                            <option value="2">2.0x</option>
                                        </select>

                                        <label class="continuous-play">
                                            <input type="checkbox" v-model="continuousPlay">
                                            <span>Auto</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <!-- Recording List -->
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">
                                    Recordings ({{ filteredRecordings.length }})
                                    <span v-if="isPreloading" style="margin-left: 10px; color: #888;">
                                        Loading... {{ preloadProgress }}%
                                    </span>
                                </div>
                                <div class="recording-list-container">
                                    <ul class="recording-list">
                                        <li
                                            v-for="(rec, idx) in filteredRecordings"
                                            :key="rec.filename"
                                            class="recording-item"
                                            :class="{ playing: isCurrentlyPlaying(rec) }"
                                            @click="play(rec, idx)">
                                            <span class="rec-icon">{{ isCurrentlyPlaying(rec) ? '&#9654;' : '&#9679;' }}</span>
                                            <span class="rec-time">{{ formatDisplayTime(rec) }}</span>
                                            <span class="rec-duration">{{ rec.audioDuration ? formatTime(rec.audioDuration) : '--:--' }}</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Empty State -->
                        <div class="empty-state" v-else>
                            <p>No audio recordings found.</p>
                            <p>Audio files should be named: REC-YYMMDD-HHMMSS-FREQ.mp3</p>
                        </div>
                    </div>
                </div>
            `
        });

        // Inject container and mount
        console.log('[RadioArchive] Looking for .container...');
        const container = document.querySelector('.container');
        console.log('[RadioArchive] container =', container);

        if (container) {
            const h1 = container.querySelector('h1');
            const table = container.querySelector('table');
            console.log('[RadioArchive] h1 =', h1);
            console.log('[RadioArchive] table =', table);

            if (h1 && table) {
                // Create Vue mount point
                const appContainer = document.createElement('div');
                appContainer.id = 'radio-archive-app';
                h1.after(appContainer);
                console.log('[RadioArchive] App container inserted after h1');

                // Remove the original h1 title "OpenWebRX+ Received Files"
                h1.remove();
                console.log('[RadioArchive] Removed h1 title');

                // Wrap original table (not active by default since we default to timeline view)
                const originalView = document.createElement('div');
                originalView.id = 'original-files-view';
                originalView.className = 'radio-archive-view';
                table.parentNode.insertBefore(originalView, table);
                originalView.appendChild(table);
                console.log('[RadioArchive] Original table wrapped');

                // Mount Vue app
                console.log('[RadioArchive] Mounting Vue app...');
                app.mount('#radio-archive-app');
                console.log('[RadioArchive] Mounted successfully!');
            } else {
                console.error('[RadioArchive] h1 or table not found in container');
            }
        } else {
            console.error('[RadioArchive] .container not found');
        }

    }).catch(err => {
        console.error('[RadioArchive] Failed to initialize:', err);
        console.error('[RadioArchive] Error stack:', err.stack);
    });
    } // end of init()

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        console.log('[RadioArchive] DOM still loading, waiting for DOMContentLoaded...');
        document.addEventListener('DOMContentLoaded', init);
    } else {
        console.log('[RadioArchive] DOM already ready, calling init() directly');
        init();
    }

})();
