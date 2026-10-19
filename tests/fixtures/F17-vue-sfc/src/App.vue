<script setup lang="ts">
import { ref } from 'vue';
import Counter from './components/Counter.vue';
import Legacy from './components/Legacy.vue';

const title = ref('f17');
</script>

<template>
  <h1>{{ title }}</h1>
  <Counter :start="1" />
  <Legacy />
</template>
