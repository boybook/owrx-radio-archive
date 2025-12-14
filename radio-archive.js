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
    // SilenceAnalyzer - Audio silence detection with IndexedDB caching
    // ==========================================
    const SilenceAnalyzer = {
        dbName: 'RadioArchiveCache',
        storeName: 'silenceMap',
        db: null,

        // Initialize IndexedDB
        async initDB() {
            if (this.db) return this.db;

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve(this.db);
                };
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: 'filename' });
                    }
                };
            });
        },

        // Get from cache
        async getFromCache(filename) {
            try {
                await this.initDB();
                return new Promise((resolve) => {
                    const tx = this.db.transaction(this.storeName, 'readonly');
                    const store = tx.objectStore(this.storeName);
                    const request = store.get(filename);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                });
            } catch (e) {
                console.warn('[SilenceAnalyzer] Cache read error:', e);
                return null;
            }
        },

        // Save to cache
        async saveToCache(filename, data) {
            try {
                await this.initDB();
                return new Promise((resolve) => {
                    const tx = this.db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.put({ filename, ...data, timestamp: Date.now() });
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                });
            } catch (e) {
                console.warn('[SilenceAnalyzer] Cache write error:', e);
            }
        },

        // Delete from cache (for force refresh)
        async deleteFromCache(filename) {
            try {
                await this.initDB();
                return new Promise((resolve) => {
                    const tx = this.db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.delete(filename);
                    tx.oncomplete = () => {
                        console.log('[SilenceAnalyzer] Deleted from cache:', filename);
                        resolve();
                    };
                    tx.onerror = () => resolve();
                });
            } catch (e) {
                console.warn('[SilenceAnalyzer] Cache delete error:', e);
            }
        },

        // Check if recording is recent based on filename timestamp (UTC)
        // If allRecordings is provided, also check if there's a newer recording with same frequency
        isRecordingRecent(filename, thresholdMs = 2 * 60 * 60 * 1000, allRecordings = null) {
            // Parse: REC-YYMMDD-HHMMSS-FREQ.mp3
            const match = filename.match(/^REC-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d+)/i);
            if (!match) return false;

            const [, yy, mm, dd, hh, min, ss, freq] = match;
            const recordingTime = Date.UTC(
                2000 + parseInt(yy, 10),
                parseInt(mm, 10) - 1,
                parseInt(dd, 10),
                parseInt(hh, 10),
                parseInt(min, 10),
                parseInt(ss, 10)
            );
            const frequency = parseInt(freq, 10);

            const now = Date.now();
            const isWithinThreshold = (now - recordingTime) < thresholdMs;

            // If not within time threshold, definitely not recent
            if (!isWithinThreshold) return false;

            // If no recordings list provided, just use time-based check
            if (!allRecordings || !Array.isArray(allRecordings)) return true;

            // Check if there's a newer recording with the same frequency
            const hasNewerSameFreq = allRecordings.some(r => {
                if (r.filename === filename) return false;  // Skip self
                if (r.frequency !== frequency) return false;  // Different frequency
                // Compare timestamps: r.date is a Date object
                return r.date.getTime() > recordingTime;
            });

            // If there's a newer recording with same frequency, this one is not "recent" (not actively recording)
            return !hasNewerSameFreq;
        },

        // Main analyze function
        async analyze(audioUrl, filename, options = {}) {
            const {
                silenceThreshold = 0.01,
                minSilenceDuration = 2,
                blockDuration = 0.1,
                onProgress = null,
                allRecordings = null  // Pass recordings list to check for newer files
            } = options;

            // 1. Check if recording is recent (within 2 hours) - skip cache for recent recordings
            const isRecent = this.isRecordingRecent(filename, 2 * 60 * 60 * 1000, allRecordings);

            // 2. Check cache (skip for recent recordings that might still be recording)
            if (!isRecent) {
                const cached = await this.getFromCache(filename);
                if (cached && cached.segments) {
                    console.log('[SilenceAnalyzer] Using cached data for', filename);
                    if (onProgress) onProgress({ stage: 'ready', progress: 1 });
                    return cached;
                }
            } else {
                console.log('[SilenceAnalyzer] Skipping cache for recent recording:', filename);
            }

            // 3. Download complete file
            console.log('[SilenceAnalyzer] Downloading', audioUrl);
            if (onProgress) onProgress({ stage: 'downloading', progress: 0 });

            const response = await fetch(audioUrl);
            const contentLength = response.headers.get('content-length');
            const total = parseInt(contentLength, 10) || 0;

            const reader = response.body.getReader();
            const chunks = [];
            let loaded = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (onProgress && total) {
                    onProgress({ stage: 'downloading', progress: loaded / total });
                }
            }

            const arrayBuffer = new Uint8Array(loaded);
            let offset = 0;
            for (const chunk of chunks) {
                arrayBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            // 3. Decode audio
            console.log('[SilenceAnalyzer] Decoding audio...');
            if (onProgress) onProgress({ stage: 'decoding', progress: 0 });

            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.buffer);
            audioContext.close();

            // 4. Analyze silence
            console.log('[SilenceAnalyzer] Analyzing silence...');
            if (onProgress) onProgress({ stage: 'analyzing', progress: 0 });

            const channelData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            const blockSize = Math.floor(sampleRate * blockDuration);

            const segments = [];
            let currentSegment = null;

            for (let i = 0; i < channelData.length; i += blockSize) {
                // Calculate RMS
                let sum = 0;
                const end = Math.min(i + blockSize, channelData.length);
                for (let j = i; j < end; j++) {
                    sum += channelData[j] * channelData[j];
                }
                const rms = Math.sqrt(sum / (end - i));
                const isSilence = rms < silenceThreshold;

                const timePos = i / sampleRate;

                if (!currentSegment || currentSegment.isSilence !== isSilence) {
                    if (currentSegment) {
                        currentSegment.end = timePos;
                        segments.push(currentSegment);
                    }
                    currentSegment = { start: timePos, isSilence };
                }

                // Progress callback
                if (onProgress && i % (blockSize * 50) === 0) {
                    onProgress({ stage: 'analyzing', progress: i / channelData.length });
                }
            }

            // Last segment
            if (currentSegment) {
                currentSegment.end = audioBuffer.duration;
                segments.push(currentSegment);
            }

            // 5. Merge short segments
            const mergedSegments = this.mergeSegments(segments, minSilenceDuration);

            // 6. Generate result
            const result = {
                duration: audioBuffer.duration,
                sampleRate: sampleRate,
                segments: mergedSegments,
                activeSegments: mergedSegments.filter(s => !s.isSilence),
                silenceSegments: mergedSegments.filter(s => s.isSilence),
                totalActiveTime: mergedSegments
                    .filter(s => !s.isSilence)
                    .reduce((sum, s) => sum + (s.end - s.start), 0)
            };

            // 7. Save to cache (always save, including recent recordings for default display)
            await this.saveToCache(filename, result);

            if (onProgress) onProgress({ stage: 'ready', progress: 1 });
            console.log('[SilenceAnalyzer] Analysis complete:', result.activeSegments.length, 'active segments');

            return result;
        },

        // Merge short segments
        mergeSegments(segments, minSilenceDuration) {
            const result = [];
            let pending = null;

            for (const seg of segments) {
                const duration = seg.end - seg.start;

                // Short silence merges into previous active segment
                if (seg.isSilence && duration < minSilenceDuration) {
                    if (pending && !pending.isSilence) {
                        pending.end = seg.end;
                    }
                    continue;
                }

                // Very short active segment (< 0.5s) might be noise, skip
                if (!seg.isSilence && duration < 0.5) {
                    continue;
                }

                if (pending && pending.isSilence === seg.isSilence) {
                    pending.end = seg.end;
                } else {
                    if (pending) result.push(pending);
                    pending = { ...seg };
                }
            }

            if (pending) result.push(pending);
            return result;
        }
    };

    // ==========================================
    // i18n - Internationalization
    // ==========================================
    const i18n = {
        messages: {
            en: {
                receivedFiles: 'Received Files',
                radioArchive: 'Radio Archive',
                frequency: 'Frequency',
                date: 'Date',
                timeline: 'Timeline',
                recordings: 'Recordings',
                noTrackSelected: 'No track selected',
                auto: 'Auto',
                zoomIn: 'Zoom In',
                zoomOut: 'Zoom Out',
                reset: 'Reset',
                noRecordings: 'No audio recordings found.',
                fileNamingHint: 'Audio files should be named: REC-YYMMDD-HHMMSS-FREQ.mp3',
                loading: 'Loading...',
                downloadingAudio: 'Downloading...',
                decodingAudio: 'Decoding...',
                analyzingSilence: 'Analyzing...',
                skipSilence: 'Skip silence',
                activeSegments: 'segments',
                refresh: 'Refresh'
            },
            zh: {
                receivedFiles: '已接收文件',
                radioArchive: '录音存档',
                frequency: '频率',
                date: '日期',
                timeline: '时间轴',
                recordings: '录音',
                noTrackSelected: '未选择音轨',
                auto: '自动',
                zoomIn: '放大',
                zoomOut: '缩小',
                reset: '重置',
                noRecordings: '未找到录音文件',
                fileNamingHint: '音频文件命名格式：REC-YYMMDD-HHMMSS-FREQ.mp3',
                loading: '加载中...',
                downloadingAudio: '下载中...',
                decodingAudio: '解码中...',
                analyzingSilence: '分析中...',
                skipSilence: '跳过静噪',
                activeSegments: '个片段',
                refresh: '刷新'
            },
            ja: {
                receivedFiles: '受信ファイル',
                radioArchive: '録音アーカイブ',
                frequency: '周波数',
                date: '日付',
                timeline: 'タイムライン',
                recordings: '録音',
                noTrackSelected: 'トラック未選択',
                auto: '自動',
                zoomIn: 'ズームイン',
                zoomOut: 'ズームアウト',
                reset: 'リセット',
                noRecordings: '録音ファイルが見つかりません',
                fileNamingHint: 'ファイル名形式：REC-YYMMDD-HHMMSS-FREQ.mp3',
                loading: '読み込み中...',
                downloadingAudio: 'ダウンロード中...',
                decodingAudio: 'デコード中...',
                analyzingSilence: '分析中...',
                skipSilence: '無音スキップ',
                activeSegments: 'セグメント',
                refresh: '更新'
            }
        },

        detectLanguage() {
            const lang = navigator.language || navigator.userLanguage || 'en';
            const shortLang = lang.split('-')[0].toLowerCase();
            if (this.messages[shortLang]) {
                return shortLang;
            }
            return 'en';
        },

        currentLang: null,

        init() {
            this.currentLang = this.detectLanguage();
            console.log('[RadioArchive] Detected language:', this.currentLang);
        },

        t(key) {
            const msgs = this.messages[this.currentLang] || this.messages.en;
            return msgs[key] || this.messages.en[key] || key;
        }
    };

    i18n.init();

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
            // 文件名中的时间是 UTC 时间
            const utcYear = 2000 + parseInt(yy, 10);
            const utcMonth = parseInt(mm, 10) - 1;
            const utcDay = parseInt(dd, 10);
            const utcHours = parseInt(hh, 10);
            const utcMinutes = parseInt(min, 10);
            const utcSeconds = parseInt(ss, 10);
            const frequency = parseInt(freq, 10);

            // 创建 UTC 时间的 Date 对象
            const date = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHours, utcMinutes, utcSeconds));

            // dateKey 基于本地时区的日期（用于日期选择器）
            const localYear = date.getFullYear();
            const localMonth = date.getMonth() + 1;
            const localDay = date.getDate();
            const dateKey = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}`;

            // hours/minutes/seconds 使用本地时区的值（用于显示）
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const seconds = date.getSeconds();

            // timeOfDay 基于本地时区（用于时间轴定位）
            const timeOfDay = hours * 3600 + minutes * 60 + seconds;

            return {
                filename,
                date,
                dateKey,
                hours,
                minutes,
                seconds,
                frequency,
                freqMHz: frequency / 1000,
                timeOfDay,
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

        const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

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

                // Silence analysis state
                const analysisState = ref('idle');  // 'idle' | 'downloading' | 'decoding' | 'analyzing' | 'ready'
                const analysisProgress = ref(0);
                const analysisCache = reactive(new Map());  // Map<filename, analysisResult>
                const skipSilence = ref(true);  // 默认开启跳过静噪

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

                // Current track's analysis result
                const currentAnalysis = computed(() => {
                    if (!currentTrack.value) return null;
                    return analysisCache.get(currentTrack.value.filename) || null;
                });

                // For timeline positioning
                const SECONDS_PER_DAY = 86400;

                // 获取前一天延续到当天的录音（跨日显示）
                const crossDayRecordings = computed(() => {
                    if (!selectedDate.value) return [];

                    // 计算前一天的 dateKey
                    const currentDate = new Date(selectedDate.value + 'T00:00:00');
                    const prevDate = new Date(currentDate);
                    prevDate.setDate(prevDate.getDate() - 1);
                    const prevDateKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;

                    // 找出前一天的录音中，延续到当天的
                    return recordings.value
                        .filter(r => {
                            // 必须是前一天的录音
                            if (r.dateKey !== prevDateKey) return false;
                            // 必须匹配当前频率筛选
                            if (selectedFreq.value && r.frequency !== selectedFreq.value) return false;

                            // 计算录音结束时间
                            const analysis = analysisCache.get(r.filename);
                            const duration = analysis?.duration
                                || (r.audioDuration && isFinite(r.audioDuration) ? r.audioDuration : 0);

                            // 如果没有时长信息，不显示跨日
                            if (duration <= 0) return false;

                            // 检查是否跨日：timeOfDay + duration > 86400
                            return r.timeOfDay + duration > SECONDS_PER_DAY;
                        })
                        .map(r => {
                            // 调整 timeOfDay 为负值，表示从当天 00:00 之前开始
                            const offsetTime = r.timeOfDay - SECONDS_PER_DAY;
                            return {
                                ...r,
                                timeOfDay: offsetTime,
                                isCrossDay: true  // 标记为跨日录音
                            };
                        });
                });

                // 时间轴上显示的录音（包含跨日录音）
                const timelineRecordings = computed(() => {
                    return [...crossDayRecordings.value, ...filteredRecordings.value];
                });
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

                // Load cached analysis data for all recordings
                async function loadCachedAnalysis() {
                    console.log('[RadioArchive] Loading cached analysis data...');
                    let loadedCount = 0;

                    for (let i = 0; i < recordings.value.length; i++) {
                        const rec = recordings.value[i];
                        const cached = await SilenceAnalyzer.getFromCache(rec.filename);

                        if (cached && cached.segments) {
                            // Update analysisCache
                            analysisCache.set(rec.filename, cached);

                            // Update recording duration
                            if (cached.duration && isFinite(cached.duration)) {
                                recordings.value[i] = {
                                    ...recordings.value[i],
                                    audioDuration: cached.duration
                                };
                            }
                            loadedCount++;
                        }
                    }

                    console.log('[RadioArchive] Loaded cached analysis for', loadedCount, 'recordings');
                }

                function switchView(view) {
                    activeView.value = view;
                }

                function selectDate(dateKey) {
                    const oldDate = selectedDate.value;
                    selectedDate.value = dateKey;

                    // Stop playback if current track is not in new filter
                    if (currentTrack.value && oldDate !== dateKey) {
                        const trackDate = currentTrack.value.dateKey;
                        const matchesCurrent = trackDate === dateKey;

                        // Check if it's a cross-day recording (previous day extends into current day)
                        let matchesCrossDay = false;
                        if (trackDate !== dateKey) {
                            const analysis = analysisCache.get(currentTrack.value.filename);
                            const dur = analysis?.duration || currentTrack.value.audioDuration || 0;
                            if (currentTrack.value.timeOfDay + dur > SECONDS_PER_DAY) {
                                // Calculate next day's dateKey
                                const nextDate = new Date(currentTrack.value.date);
                                nextDate.setDate(nextDate.getDate() + 1);
                                const nextDateKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
                                matchesCrossDay = nextDateKey === dateKey;
                            }
                        }

                        if (!matchesCurrent && !matchesCrossDay) {
                            // Stop playback
                            if (audio.value) {
                                audio.value.pause();
                                audio.value.src = '';
                            }
                            currentTrack.value = null;
                            currentIndex.value = -1;
                            isPlaying.value = false;
                            currentTime.value = 0;
                            duration.value = 0;
                        }
                    }
                }

                function selectFreq(freq) {
                    const oldFreq = selectedFreq.value;
                    selectedFreq.value = freq;

                    // Stop playback if current track doesn't match new frequency filter
                    if (currentTrack.value && oldFreq !== freq) {
                        if (freq && currentTrack.value.frequency !== freq) {
                            // Stop playback
                            if (audio.value) {
                                audio.value.pause();
                                audio.value.src = '';
                            }
                            currentTrack.value = null;
                            currentIndex.value = -1;
                            isPlaying.value = false;
                            currentTime.value = 0;
                            duration.value = 0;
                        }
                    }
                }

                function prevDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    if (idx > 0) {
                        selectDate(availableDates.value[idx - 1]);
                    }
                }

                function nextDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    if (idx < availableDates.value.length - 1) {
                        selectDate(availableDates.value[idx + 1]);
                    }
                }

                function canPrevDate() {
                    return availableDates.value.indexOf(selectedDate.value) > 0;
                }

                function canNextDate() {
                    const idx = availableDates.value.indexOf(selectedDate.value);
                    return idx < availableDates.value.length - 1;
                }

                // Get the base segment for a recording (full duration, shown as background)
                function getRecordingBaseSegment(rec) {
                    const analysis = analysisCache.get(rec.filename);
                    const actualDuration = analysis?.duration
                        || (rec.audioDuration && isFinite(rec.audioDuration) ? rec.audioDuration : 60);

                    return {
                        start: rec.timeOfDay,
                        end: rec.timeOfDay + actualDuration,
                        audioStart: 0,
                        audioEnd: actualDuration,
                        recording: rec
                    };
                }

                // Check if a recording has been analyzed
                function isRecordingAnalyzed(rec) {
                    const analysis = analysisCache.get(rec.filename);
                    return analysis && analysis.activeSegments && analysis.activeSegments.length > 0;
                }

                // Get active segments for a recording (only non-silence parts)
                function getRecordingActiveSegments(rec) {
                    const analysis = analysisCache.get(rec.filename);

                    if (!analysis || !analysis.activeSegments || analysis.activeSegments.length === 0) {
                        return [];
                    }

                    // Return active segments mapped to day time
                    return analysis.activeSegments.map(seg => ({
                        start: rec.timeOfDay + seg.start,
                        end: rec.timeOfDay + seg.end,
                        audioStart: seg.start,
                        audioEnd: seg.end,
                        recording: rec
                    }));
                }

                // Calculate style for a sub-segment (supports cross-day negative values)
                function getSubSegmentStyle(seg) {
                    const dur = visibleDuration.value;
                    const startTime = viewStartTime.value;
                    const endTime = viewEndTime.value;

                    // Outside visible range
                    if (seg.end < startTime || seg.start > endTime) {
                        return { display: 'none' };
                    }

                    // Calculate left (may be negative for cross-day recordings)
                    const left = ((seg.start - startTime) / dur) * 100;
                    const width = Math.max(0.3, ((seg.end - seg.start) / dur) * 100);

                    // Clamp negative left to 0, adjust width accordingly
                    if (left < 0) {
                        const clampedWidth = width + left;  // left is negative, so this reduces width
                        if (clampedWidth <= 0.3) {
                            return { display: 'none' };
                        }
                        return {
                            left: '0%',
                            width: `${clampedWidth}%`
                        };
                    }

                    return {
                        left: `${left}%`,
                        width: `${width}%`
                    };
                }

                // Format segment title for tooltip
                function formatSegmentTitle(seg) {
                    const startTime = new Date(seg.recording.date.getTime() + seg.audioStart * 1000);
                    const timeStr = FileParser.formatTime(startTime);
                    const durationStr = FileParser.formatDuration(seg.audioEnd - seg.audioStart);
                    return `${timeStr} (${durationStr})`;
                }

                // Get analysis state text for UI
                function getAnalysisStateText() {
                    const texts = {
                        downloading: t('downloadingAudio'),
                        decoding: t('decodingAudio'),
                        analyzing: t('analyzingSilence')
                    };
                    return texts[analysisState.value] || '';
                }

                // Audio control
                async function analyzeRecording(recording) {
                    // Check if recording is recent (within 2 hours and no newer file with same frequency)
                    const isRecent = SilenceAnalyzer.isRecordingRecent(
                        recording.filename,
                        2 * 60 * 60 * 1000,
                        recordings.value
                    );

                    // Only use memory cache for non-recent recordings
                    if (!isRecent && analysisCache.has(recording.filename)) {
                        return analysisCache.get(recording.filename);
                    }

                    analysisState.value = 'downloading';
                    analysisProgress.value = 0;

                    try {
                        const result = await SilenceAnalyzer.analyze(
                            recording.href,
                            recording.filename,
                            {
                                silenceThreshold: 0.01,
                                minSilenceDuration: 2,
                                allRecordings: recordings.value,
                                onProgress: ({ stage, progress }) => {
                                    analysisState.value = stage;
                                    analysisProgress.value = Math.round(progress * 100);
                                }
                            }
                        );

                        analysisCache.set(recording.filename, result);

                        // 同步更新录音列表中的时长，触发 Vue 响应式更新
                        if (result && result.duration) {
                            const index = recordings.value.findIndex(r => r.filename === recording.filename);
                            if (index !== -1) {
                                recordings.value[index] = {
                                    ...recordings.value[index],
                                    audioDuration: result.duration
                                };
                                console.log('[RadioArchive] Updated recording duration:', recording.filename, result.duration);
                            }
                        }

                        analysisState.value = 'ready';
                        return result;
                    } catch (e) {
                        console.error('[RadioArchive] Analysis failed:', e);
                        analysisState.value = 'idle';
                        return null;
                    }
                }

                // Force refresh: clear cache and re-analyze
                async function refreshRecording(recording) {
                    console.log('[RadioArchive] Force refreshing:', recording.filename);

                    // Clear memory cache
                    analysisCache.delete(recording.filename);

                    // Clear IndexedDB cache
                    await SilenceAnalyzer.deleteFromCache(recording.filename);

                    // Re-analyze (will download fresh)
                    await analyzeRecording(recording);
                }

                function initAudio() {
                    if (!audio.value) {
                        audio.value = new Audio();
                        audio.value.addEventListener('timeupdate', onTimeUpdate);
                        audio.value.addEventListener('loadedmetadata', onLoadedMetadata);
                        audio.value.addEventListener('durationchange', onDurationChange);
                        audio.value.addEventListener('ended', onEnded);
                        audio.value.addEventListener('play', () => isPlaying.value = true);
                        audio.value.addEventListener('pause', () => isPlaying.value = false);
                    }
                }

                async function play(recording, index, startPosition = 0) {
                    initAudio();

                    // If clicking on same track, toggle play/pause
                    if (currentTrack.value?.filename === recording.filename && startPosition === 0) {
                        if (isPlaying.value) {
                            audio.value.pause();
                        } else {
                            audio.value.play();
                        }
                        return;
                    }

                    // Check if analysis is needed (new recording or recent recording that may have changed)
                    const isRecent = SilenceAnalyzer.isRecordingRecent(
                        recording.filename,
                        2 * 60 * 60 * 1000,
                        recordings.value
                    );
                    const needsAnalysis = !analysisCache.has(recording.filename) || isRecent;

                    if (needsAnalysis) {
                        await analyzeRecording(recording);
                    }

                    currentTrack.value = recording;
                    currentIndex.value = index !== undefined ? index : filteredRecordings.value.indexOf(recording);

                    // Use analysis duration or preloaded duration
                    const analysis = analysisCache.get(recording.filename);
                    if (analysis && analysis.duration) {
                        duration.value = analysis.duration;
                    } else if (recording.audioDuration && isFinite(recording.audioDuration)) {
                        duration.value = recording.audioDuration;
                    } else {
                        duration.value = 0;
                    }

                    // 如果开启跳过静噪且未指定起始位置，检查是否需要跳到第一个有效段
                    let effectiveStartPosition = startPosition;
                    if (skipSilence.value && startPosition === 0 && analysis && analysis.activeSegments && analysis.activeSegments.length > 0) {
                        const firstActive = analysis.activeSegments[0];
                        // 如果第一个有效段不是从开头开始，跳到该段起始位置
                        if (firstActive.start > 0.5) {  // 允许0.5秒的容差
                            effectiveStartPosition = firstActive.start;
                            console.log('[RadioArchive] Skipping initial silence, jumping to', effectiveStartPosition);
                        }
                    }

                    audio.value.src = recording.href;
                    audio.value.volume = volume.value;
                    audio.value.playbackRate = playbackRate.value;

                    // If startPosition specified, seek after load
                    if (effectiveStartPosition > 0) {
                        audio.value.addEventListener('loadedmetadata', function seekOnce() {
                            audio.value.currentTime = effectiveStartPosition;
                            audio.value.removeEventListener('loadedmetadata', seekOnce);
                        });
                    }

                    audio.value.play();
                }

                // Play recording at specific position (for timeline segment click)
                function playAtPosition(recording, position) {
                    const index = filteredRecordings.value.indexOf(recording);
                    play(recording, index, position);
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

                // 获取可跳转的时长估计值
                function getSeekableDuration() {
                    // 1. 优先使用已知的精确时长
                    if (duration.value && isFinite(duration.value) && duration.value > 0) {
                        return duration.value;
                    }

                    if (!audio.value) return 0;

                    // 2. 尝试从 audio.seekable 获取可跳转范围
                    try {
                        if (audio.value.seekable && audio.value.seekable.length > 0) {
                            const seekableEnd = audio.value.seekable.end(audio.value.seekable.length - 1);
                            if (isFinite(seekableEnd) && seekableEnd > 0) {
                                return seekableEnd;
                            }
                        }
                    } catch (e) {
                        // seekable 可能不可用
                    }

                    // 3. 尝试从 audio.buffered 获取已缓冲范围
                    try {
                        if (audio.value.buffered && audio.value.buffered.length > 0) {
                            const bufferedEnd = audio.value.buffered.end(audio.value.buffered.length - 1);
                            if (isFinite(bufferedEnd) && bufferedEnd > 0) {
                                return bufferedEnd;
                            }
                        }
                    } catch (e) {
                        // buffered 可能不可用
                    }

                    // 4. 使用当前时间的 2 倍作为估计值，最少 60 秒
                    return Math.max(currentTime.value * 2, 60);
                }

                function seek(e) {
                    if (!audio.value) return;

                    const seekableDuration = getSeekableDuration();
                    if (seekableDuration <= 0) {
                        console.log('[RadioArchive] Cannot seek: no seekable duration');
                        return;
                    }

                    const percent = e.target.value / 100;
                    const newTime = percent * seekableDuration;
                    if (isFinite(newTime) && newTime >= 0) {
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

                    // 如果未开启跳过静噪，让音频自然播放，不做任何干预
                    if (!skipSilence.value) {
                        return;
                    }

                    // Skip silence logic - only when skipSilence is enabled
                    const analysis = currentAnalysis.value;
                    if (!analysis) {
                        return;
                    }

                    // 如果没有有效音频段，不跳过，让音频正常播放到结束
                    if (!analysis.activeSegments || analysis.activeSegments.length === 0) {
                        return;
                    }

                    // 检查当前是否在静噪段
                    const currentSeg = analysis.segments.find(
                        s => currentTime.value >= s.start && currentTime.value < s.end
                    );

                    if (currentSeg && currentSeg.isSilence) {
                        // Find next active segment
                        const nextActive = analysis.activeSegments.find(s => s.start > currentTime.value);
                        if (nextActive) {
                            console.log('[RadioArchive] Skipping silence, jumping to', nextActive.start);
                            audio.value.currentTime = nextActive.start;
                        } else {
                            // 没有更多有效段了，触发结束逻辑
                            console.log('[RadioArchive] No more active segments, triggering end');
                            // 停止播放，避免重复触发
                            audio.value.pause();
                            onEnded();
                        }
                    }
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
                    if (isFinite(audio.value.duration) && audio.value.duration > 0) {
                        duration.value = audio.value.duration;
                        console.log('[RadioArchive] Duration changed:', duration.value);

                        // Update the recording object in the array for Vue reactivity
                        if (currentTrack.value) {
                            const index = recordings.value.findIndex(r => r.filename === currentTrack.value.filename);
                            if (index !== -1 && !recordings.value[index].audioDuration) {
                                recordings.value[index] = {
                                    ...recordings.value[index],
                                    audioDuration: audio.value.duration
                                };
                                console.log('[RadioArchive] Updated recording duration:', currentTrack.value.filename, audio.value.duration);
                            }
                        }
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
                    const seekableDuration = getSeekableDuration();
                    if (seekableDuration <= 0) return 0;
                    return Math.min(100, (currentTime.value / seekableDuration) * 100);
                }

                function isCurrentlyPlaying(rec) {
                    return currentTrack.value?.filename === rec.filename;
                }

                // Playhead position on timeline (支持缩放，显示实时播放进度)
                function getPlayheadStyle() {
                    if (!currentTrack.value) return { display: 'none' };

                    // 计算当前播放位置：录音开始时间 + 当前播放进度
                    const playheadTime = currentTrack.value.timeOfDay + currentTime.value;
                    const startTime = viewStartTime.value;
                    const endTime = viewEndTime.value;

                    // 如果播放头在可视范围外，隐藏
                    if (playheadTime < startTime || playheadTime > endTime) {
                        return { display: 'none' };
                    }

                    const left = ((playheadTime - startTime) / visibleDuration.value) * 100;
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

                // 鼠标滚轮/触摸板手势
                function handleWheel(e) {
                    const rect = e.currentTarget.getBoundingClientRect();

                    // Mac 触摸板捏合缩放：ctrlKey 为 true
                    if (e.ctrlKey) {
                        const positionRatio = (e.clientX - rect.left) / rect.width;
                        // deltaY > 0 表示缩小，deltaY < 0 表示放大
                        const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
                        zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio);
                        return;
                    }

                    // Mac 触摸板双指滑动 或 鼠标滚轮
                    // deltaX: 水平滑动（用于平移时间轴）
                    // deltaY: 垂直滚动（也可用于缩放，可选）
                    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                        // 水平滑动为主：平移时间轴
                        const deltaTime = (e.deltaX / rect.width) * visibleDuration.value * 2;
                        viewStartTime.value = clampViewStart(viewStartTime.value + deltaTime);
                    } else {
                        // 垂直滚动为主：缩放
                        const positionRatio = (e.clientX - rect.left) / rect.width;
                        const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
                        zoomAtPosition(zoomLevel.value * zoomFactor, positionRatio);
                    }
                }

                // 拖拽平移：开始
                function handlePointerDown(e) {
                    // 只响应鼠标左键或触摸
                    if (e.pointerType === 'mouse' && e.button !== 0) return;

                    // 如果点击的是录音片段，不启动拖拽，让 click 事件处理
                    if (e.target.closest('.timeline-segment')) {
                        return;
                    }

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
                    // 如果触摸的是录音片段，不处理，让 click 事件处理
                    if (e.target.closest('.timeline-segment')) {
                        return;
                    }

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
                        if (audio.value) {
                            // 直接增加时间，浏览器会自动限制在有效范围内
                            // 如果超出实际时长，会触发 ended 事件或限制在最大值
                            audio.value.currentTime = audio.value.currentTime + 5;
                        }
                    }
                }

                onMounted(() => {
                    nextTick(async () => {
                        parseFilesFromDOM();
                        // Load cached analysis data (duration, segments) from IndexedDB
                        await loadCachedAnalysis();
                    });

                    // Add keyboard listener
                    document.addEventListener('keydown', handleKeydown);
                });

                onUnmounted(() => {
                    // Remove keyboard listener
                    document.removeEventListener('keydown', handleKeydown);
                });

                // i18n helper
                function t(key) {
                    return i18n.t(key);
                }

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
                    // Silence Analysis State
                    analysisState,
                    analysisProgress,
                    analysisCache,
                    skipSilence,
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
                    timelineRecordings,
                    currentAnalysis,
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
                    getRecordingBaseSegment,
                    isRecordingAnalyzed,
                    getRecordingActiveSegments,
                    getSubSegmentStyle,
                    formatSegmentTitle,
                    getAnalysisStateText,
                    play,
                    refreshRecording,
                    playAtPosition,
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
                    handleTouchEnd,
                    // i18n
                    t
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
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">{{ t('frequency') }}</div>
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
                                <div class="radio-archive-section-label">{{ t('date') }}</div>
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
                                                <!-- Base layer: full duration (light color) -->
                                                <div
                                                    class="timeline-segment base"
                                                    :class="{ playing: isCurrentlyPlaying(rec) }"
                                                    :style="getSubSegmentStyle(getRecordingBaseSegment(rec))"
                                                    :title="formatSegmentTitle(getRecordingBaseSegment(rec))"
                                                    @click.stop="playAtPosition(rec, 0)">
                                                </div>
                                                <!-- Active layer: non-silence segments (green) -->
                                                <div
                                                    v-for="(seg, segIdx) in getRecordingActiveSegments(rec)"
                                                    :key="rec.filename + '-active-' + segIdx"
                                                    class="timeline-segment active"
                                                    :class="{ playing: isCurrentlyPlaying(rec) }"
                                                    :style="getSubSegmentStyle(seg)"
                                                    :title="formatSegmentTitle(seg)"
                                                    @click.stop="playAtPosition(seg.recording, seg.audioStart)">
                                                </div>
                                            </template>
                                            <div
                                                class="timeline-playhead"
                                                :style="getPlayheadStyle()"
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

                            <!-- Player -->
                            <div class="radio-archive-section">
                                <div class="player-container">
                                    <!-- Analysis status (inline) -->
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

                                        <div class="player-options">
                                            <label class="continuous-play">
                                                <input type="checkbox" v-model="continuousPlay">
                                                <span>{{ t('auto') }}</span>
                                            </label>
                                            <label class="skip-silence">
                                                <input type="checkbox" v-model="skipSilence">
                                                <span>{{ t('skipSilence') }}</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Recording List -->
                            <div class="radio-archive-section">
                                <div class="radio-archive-section-label">
                                    {{ t('recordings') }} ({{ filteredRecordings.length }})
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
                                            <span class="rec-filename-group">
                                                <span class="rec-filename">{{ rec.filename }}</span>
                                                <button
                                                    class="rec-refresh-btn"
                                                    @click.stop="refreshRecording(rec)"
                                                    :title="t('refresh')">
                                                    &#8635;
                                                </button>
                                            </span>
                                            <span class="rec-duration">{{ rec.audioDuration ? formatTime(rec.audioDuration) : '--:--' }}</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Empty State -->
                        <div class="empty-state" v-else>
                            <p>{{ t('noRecordings') }}</p>
                            <p>{{ t('fileNamingHint') }}</p>
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
