<template>
    <div class="radio-archive-section">
        <div class="radio-archive-section-label">{{ t('date') }}</div>
        <div class="date-selector">
            <button class="date-btn" @click="$emit('prev')" :disabled="!canPrev">&#8249;</button>
            <input
                type="date"
                class="date-input"
                :value="selectedDate"
                @change="$emit('select', $event.target.value)">
            <button class="date-btn" @click="$emit('next')" :disabled="!canNext">&#8250;</button>
        </div>
    </div>
</template>

<script>
import { t } from '../modules/i18n.js'

export default {
    name: 'DateSelector',
    props: {
        selectedDate: {
            type: String,
            default: null
        },
        canPrev: {
            type: Boolean,
            default: false
        },
        canNext: {
            type: Boolean,
            default: false
        }
    },
    emits: ['select', 'prev', 'next'],
    setup() {
        return { t }
    }
}
</script>
