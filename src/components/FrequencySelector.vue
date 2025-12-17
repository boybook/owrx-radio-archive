<template>
    <div class="radio-archive-section">
        <div class="radio-archive-section-label">{{ t('frequency') }}</div>
        <div class="frequency-list">
            <div
                v-for="freq in availableFreqs"
                :key="freq"
                class="frequency-item"
                :class="{ selected: selectedFreq === freq }"
                @click="$emit('select', freq)">
                <span class="freq-name">{{ formatFreq(freq) }}</span>
                <span class="freq-count" v-if="freqStats[freq]">{{ freqStats[freq] }}</span>
            </div>
        </div>
    </div>
</template>

<script>
import { t } from '../modules/i18n.js'
import { formatFreq } from '../modules/fileParser.js'

export default {
    name: 'FrequencySelector',
    props: {
        availableFreqs: {
            type: Array,
            required: true
        },
        selectedFreq: {
            type: Number,
            default: null
        },
        freqStats: {
            type: Object,
            default: () => ({})
        }
    },
    emits: ['select'],
    setup() {
        return {
            t,
            formatFreq
        }
    }
}
</script>
