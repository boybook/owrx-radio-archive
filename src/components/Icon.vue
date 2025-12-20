<template>
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="currentColor"
        class="icon"
    >
        <!-- Play -->
        <path v-if="name === 'play'" d="M8 5v14l11-7z" />

        <!-- Pause -->
        <g v-else-if="name === 'pause'">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
        </g>

        <!-- Previous (skip back) -->
        <g v-else-if="name === 'prev'">
            <rect x="4" y="5" width="3" height="14" />
            <path d="M20 5v14l-10-7z" />
        </g>

        <!-- Next (skip forward) -->
        <g v-else-if="name === 'next'">
            <path d="M4 5v14l10-7z" />
            <rect x="17" y="5" width="3" height="14" />
        </g>

        <!-- Volume (speaker with waves) -->
        <g v-else-if="name === 'volume'">
            <path d="M3 9v6h4l5 5V4L7 9H3z" />
            <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                d="M15 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"
            />
        </g>
    </svg>
</template>

<script>
export default {
    name: 'Icon',
    props: {
        name: {
            type: String,
            required: true,
            validator: (value) => ['play', 'pause', 'prev', 'next', 'volume'].includes(value)
        },
        size: {
            type: [Number, String],
            default: 18
        }
    }
}
</script>

<style scoped>
.icon {
    display: inline-block;
    vertical-align: middle;
}
</style>
