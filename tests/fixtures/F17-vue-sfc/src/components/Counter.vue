<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ start: number }>();
const count = ref(props.start);
const payload = { count: count.value } as any;
</script>

<template>
  <button @click="count++">{{ count }} {{ payload.count }}</button>
</template>
