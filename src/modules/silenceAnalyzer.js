/**
 * SilenceAnalyzer - Audio silence detection with IndexedDB caching
 */
export const SilenceAnalyzer = {
    dbName: 'RadioArchiveCache',
    storeName: 'silenceMap',
    db: null,

    // Initialize IndexedDB
    async initDB() {
        if (this.db) return this.db

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                this.db = request.result
                resolve(this.db)
            }
            request.onupgradeneeded = (e) => {
                const db = e.target.result
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'filename' })
                }
            }
        })
    },

    // Get from cache
    async getFromCache(filename) {
        try {
            await this.initDB()
            return new Promise((resolve) => {
                const tx = this.db.transaction(this.storeName, 'readonly')
                const store = tx.objectStore(this.storeName)
                const request = store.get(filename)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => resolve(null)
            })
        } catch (e) {
            console.warn('[SilenceAnalyzer] Cache read error:', e)
            return null
        }
    },

    // Save to cache
    async saveToCache(filename, data) {
        try {
            await this.initDB()
            return new Promise((resolve) => {
                const tx = this.db.transaction(this.storeName, 'readwrite')
                const store = tx.objectStore(this.storeName)
                store.put({ filename, ...data, timestamp: Date.now() })
                tx.oncomplete = () => resolve()
                tx.onerror = () => resolve()
            })
        } catch (e) {
            console.warn('[SilenceAnalyzer] Cache write error:', e)
        }
    },

    // Delete from cache (for force refresh)
    async deleteFromCache(filename) {
        try {
            await this.initDB()
            return new Promise((resolve) => {
                const tx = this.db.transaction(this.storeName, 'readwrite')
                const store = tx.objectStore(this.storeName)
                store.delete(filename)
                tx.oncomplete = () => {
                    console.log('[SilenceAnalyzer] Deleted from cache:', filename)
                    resolve()
                }
                tx.onerror = () => resolve()
            })
        } catch (e) {
            console.warn('[SilenceAnalyzer] Cache delete error:', e)
        }
    },

    // Check if recording is recent based on filename timestamp (UTC)
    // If allRecordings is provided, also check if there's a newer recording with same frequency
    isRecordingRecent(filename, thresholdMs = 2 * 60 * 60 * 1000, allRecordings = null) {
        // Parse: REC-YYMMDD-HHMMSS-FREQ.mp3
        const match = filename.match(/^REC-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d+)/i)
        if (!match) return false

        const [, yy, mm, dd, hh, min, ss, freq] = match
        const recordingTime = Date.UTC(
            2000 + parseInt(yy, 10),
            parseInt(mm, 10) - 1,
            parseInt(dd, 10),
            parseInt(hh, 10),
            parseInt(min, 10),
            parseInt(ss, 10)
        )
        const frequency = parseInt(freq, 10)

        const now = Date.now()
        const isWithinThreshold = (now - recordingTime) < thresholdMs

        // If not within time threshold, definitely not recent
        if (!isWithinThreshold) return false

        // If no recordings list provided, just use time-based check
        if (!allRecordings || !Array.isArray(allRecordings)) return true

        // Check if there's a newer recording with the same frequency
        const hasNewerSameFreq = allRecordings.some(r => {
            if (r.filename === filename) return false  // Skip self
            if (r.frequency !== frequency) return false  // Different frequency
            // Compare timestamps: r.date is a Date object
            return r.date.getTime() > recordingTime
        })

        // If there's a newer recording with same frequency, this one is not "recent" (not actively recording)
        return !hasNewerSameFreq
    },

    // Main analyze function
    async analyze(audioUrl, filename, options = {}) {
        const {
            silenceThreshold = 0.01,
            minSilenceDuration = 2,
            blockDuration = 0.1,
            onProgress = null,
            allRecordings = null  // Pass recordings list to check for newer files
        } = options

        // 1. Check if recording is recent (within 2 hours) - skip cache for recent recordings
        const isRecent = this.isRecordingRecent(filename, 2 * 60 * 60 * 1000, allRecordings)

        // 2. Check cache (skip for recent recordings that might still be recording)
        if (!isRecent) {
            const cached = await this.getFromCache(filename)
            if (cached && cached.segments) {
                console.log('[SilenceAnalyzer] Using cached data for', filename)
                if (onProgress) onProgress({ stage: 'ready', progress: 1 })
                return cached
            }
        } else {
            console.log('[SilenceAnalyzer] Skipping cache for recent recording:', filename)
        }

        // 3. Download complete file
        console.log('[SilenceAnalyzer] Downloading', audioUrl)
        if (onProgress) onProgress({ stage: 'downloading', progress: 0 })

        const response = await fetch(audioUrl)
        const contentLength = response.headers.get('content-length')
        const total = parseInt(contentLength, 10) || 0

        const reader = response.body.getReader()
        const chunks = []
        let loaded = 0

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            loaded += value.length
            if (onProgress && total) {
                onProgress({ stage: 'downloading', progress: loaded / total })
            }
        }

        const arrayBuffer = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) {
            arrayBuffer.set(chunk, offset)
            offset += chunk.length
        }

        // 3. Decode audio
        console.log('[SilenceAnalyzer] Decoding audio...')
        if (onProgress) onProgress({ stage: 'decoding', progress: 0 })

        const audioContext = new (window.AudioContext || window.webkitAudioContext)()
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.buffer)
        audioContext.close()

        // 4. Analyze silence
        console.log('[SilenceAnalyzer] Analyzing silence...')
        if (onProgress) onProgress({ stage: 'analyzing', progress: 0 })

        const channelData = audioBuffer.getChannelData(0)
        const sampleRate = audioBuffer.sampleRate
        const blockSize = Math.floor(sampleRate * blockDuration)

        const segments = []
        let currentSegment = null

        for (let i = 0; i < channelData.length; i += blockSize) {
            // Calculate RMS
            let sum = 0
            const end = Math.min(i + blockSize, channelData.length)
            for (let j = i; j < end; j++) {
                sum += channelData[j] * channelData[j]
            }
            const rms = Math.sqrt(sum / (end - i))
            const isSilence = rms < silenceThreshold

            const timePos = i / sampleRate

            if (!currentSegment || currentSegment.isSilence !== isSilence) {
                if (currentSegment) {
                    currentSegment.end = timePos
                    segments.push(currentSegment)
                }
                currentSegment = { start: timePos, isSilence }
            }

            // Progress callback
            if (onProgress && i % (blockSize * 50) === 0) {
                onProgress({ stage: 'analyzing', progress: i / channelData.length })
            }
        }

        // Last segment
        if (currentSegment) {
            currentSegment.end = audioBuffer.duration
            segments.push(currentSegment)
        }

        // 5. Merge short segments
        const mergedSegments = this.mergeSegments(segments, minSilenceDuration)

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
        }

        // 7. Save to cache (always save, including recent recordings for default display)
        await this.saveToCache(filename, result)

        if (onProgress) onProgress({ stage: 'ready', progress: 1 })
        console.log('[SilenceAnalyzer] Analysis complete:', result.activeSegments.length, 'active segments')

        return result
    },

    // Merge short segments
    mergeSegments(segments, minSilenceDuration) {
        const result = []
        let pending = null

        for (const seg of segments) {
            const duration = seg.end - seg.start

            // Short silence merges into previous active segment
            if (seg.isSilence && duration < minSilenceDuration) {
                if (pending && !pending.isSilence) {
                    pending.end = seg.end
                }
                continue
            }

            // Very short active segment (< 0.5s) might be noise, skip
            if (!seg.isSilence && duration < 0.5) {
                continue
            }

            if (pending && pending.isSilence === seg.isSilence) {
                pending.end = seg.end
            } else {
                if (pending) result.push(pending)
                pending = { ...seg }
            }
        }

        if (pending) result.push(pending)
        return result
    }
}

export default SilenceAnalyzer
