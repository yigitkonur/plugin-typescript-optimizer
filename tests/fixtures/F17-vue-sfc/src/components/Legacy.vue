<template>
  <p>{{ label }}</p>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  data() {
    return { label: 'legacy' as string };
  },
  mounted() {
    const el = this.$el as any;
    el.dataset.ready = '1';
  },
});
</script>
