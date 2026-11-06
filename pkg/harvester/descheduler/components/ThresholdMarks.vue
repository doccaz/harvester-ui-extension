<script setup>
import { useTranslation } from '../utils/i18n';

/**
 * Drawn inside a utilization track (which must be `position: relative`): the underutilized zone (below `low`) and the
 * overutilized zone (above `target`) are shaded, and each threshold is a labelled marker, so the two cannot be confused.
 */
defineProps({
  low:    { type: Number, default: undefined },
  target: { type: Number, default: undefined }
});
const t = useTranslation();
const clamp = (v) => Math.min(Math.max(v, 0), 100);
</script>

<template>
  <div
    v-if="low !== undefined"
    class="zone under"
    :style="{ left: 0, width: `${ clamp(low) }%` }"
  />
  <div
    v-if="target !== undefined"
    class="zone over"
    :style="{ left: `${ clamp(target) }%`, width: `${ 100 - clamp(target) }%` }"
  />
  <div
    v-if="low !== undefined"
    class="mark under"
    :style="{ left: `${ clamp(low) }%` }"
  >
    <span class="mark-label">{{ t('harvester.descheduler.nodes.markLowShort', { value: low }) }}</span>
  </div>
  <div
    v-if="target !== undefined"
    class="mark over"
    :style="{ left: `${ clamp(target) }%` }"
  >
    <span class="mark-label">{{ t('harvester.descheduler.nodes.markTargetShort', { value: target }) }}</span>
  </div>
</template>

<style lang="scss" scoped>
.zone { position: absolute; z-index: 2; top: 0; height: 100%; pointer-events: none; }
.zone.under { background: repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255, 255, 255, 0.45) 3px, rgba(255, 255, 255, 0.45) 6px); border-radius: 7px 0 0 7px; }
.zone.over { background: repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255, 255, 255, 0.45) 3px, rgba(255, 255, 255, 0.45) 6px); border-radius: 0 7px 7px 0; }
.mark { position: absolute; z-index: 3; top: -3px; width: 2px; height: 20px; background: var(--body-text); }
.mark-label { position: absolute; top: 22px; font-size: 12px; line-height: 1; white-space: nowrap; color: var(--body-text); }
// The low label hangs to the left of its marker and the high label to the right, so close thresholds do not overlap.
.mark.under .mark-label { right: 0; }
.mark.over .mark-label { left: 0; }
</style>
