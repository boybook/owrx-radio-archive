/**
 * i18n - Internationalization module
 */

const messages = {
    en: {
        receivedFiles: 'Received Files',
        radioArchive: 'Radio Archive',
        frequency: 'Frequency',
        date: 'Date',
        timeline: 'Timeline',
        recordings: 'Recordings',
        noTrackSelected: 'No track selected',
        auto: 'Auto',
        skipShort: 'Skip Short',
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        reset: 'Reset',
        noRecordings: 'No audio recordings found.',
        fileNamingHint: 'Audio files should be named: REC-YYMMDD-HHMMSS-FREQ.mp3',
        loading: 'Loading...',
        activeSegments: 'segments'
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
        skipShort: '跳过短片',
        zoomIn: '放大',
        zoomOut: '缩小',
        reset: '重置',
        noRecordings: '未找到录音文件',
        fileNamingHint: '音频文件命名格式：REC-YYMMDD-HHMMSS-FREQ.mp3',
        loading: '加载中...',
        activeSegments: '个片段'
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
        skipShort: '短片スキップ',
        zoomIn: 'ズームイン',
        zoomOut: 'ズームアウト',
        reset: 'リセット',
        noRecordings: '録音ファイルが見つかりません',
        fileNamingHint: 'ファイル名形式：REC-YYMMDD-HHMMSS-FREQ.mp3',
        loading: '読み込み中...',
        activeSegments: 'セグメント'
    }
}

function detectLanguage() {
    const lang = navigator.language || navigator.userLanguage || 'en'
    const shortLang = lang.split('-')[0].toLowerCase()
    if (messages[shortLang]) {
        return shortLang
    }
    return 'en'
}

let currentLang = null

export function initI18n() {
    currentLang = detectLanguage()
    console.log('[RadioArchive] Detected language:', currentLang)
}

export function t(key) {
    if (!currentLang) {
        initI18n()
    }
    const msgs = messages[currentLang] || messages.en
    return msgs[key] || messages.en[key] || key
}

export function setLanguage(lang) {
    if (messages[lang]) {
        currentLang = lang
    }
}

export function getCurrentLanguage() {
    return currentLang || detectLanguage()
}

export default {
    messages,
    initI18n,
    t,
    setLanguage,
    getCurrentLanguage
}
