<script setup>
import { computed } from 'vue';
import { useTranslation } from '../utils/i18n';
import { formatPct } from '../utils/format';
import ThresholdMarks from './ThresholdMarks.vue';
/**
 * One resource on one node, now versus after the simulated moves, on a single bar: the solid fill is the "after" level, and the part
 * that changes is hatched (removed load is greyed out, added load is blue), so you can see what shrinks and what grows.
 */
const props = defineProps({
  label:  { type: String, required: true },
  before: { type: Number, required: true },
  after:  { type: Number, required: true },
  detail: { type: String, required: true },
  low:    { type: Number, default: undefined },
  target: { type: Number, default: undefined }
});
const t = useTranslation();
const clamp = (v) => Math.min(Math.max(v, 0), 100);
const solid = computed(() => `${ clamp(Math.min(props.before, props.after)) }%`);
const changeLeft = computed(() => `${ clamp(Math.min(props.before, props.after)) }%`);
const changeWidth = computed(() => `${ clamp(Math.max(props.before, props.after)) - clamp(Math.min(props.before, props.after)) }%`);
const grew = computed(() => props.after > props.before);
const aria = computed(() => [
  props.before === props.after ? `${ props.label } ${ formatPct(props.after) }` : t('harvester.descheduler.simulator.barChange', {
    label: props.label, before: formatPct(props.before), after: formatPct(props.after)
  }),
  props.low !== undefined ? t('harvester.descheduler.nodes.markLow', { value: props.low }) : '',
  props.target !== undefined ? t('harvester.descheduler.nodes.markTarget', { value: props.target }) : ''
].filter(Boolean).join('. '));
const level = computed(() => {
  if (props.target !== undefined && props.after > props.target) {
    return 'over';
  }
  if (props.low !== undefined && props.after < props.low) {
    return 'under';
  }

  return 'ok';
});
</script>

<template>
  <div class="ba">
    <div class="ba-head">
      <span class="ba-label">{{ label }}</span>
      <span class="ba-pct">
        <template v-if="before !== after">{{ formatPct(before) }} → <strong>{{ formatPct(after) }}</strong></template>
        <template v-else>{{ formatPct(after) }}</template>
      </span>
      <span class="ba-detail text-muted">{{ detail }}</span>
    </div>
    <div
      class="ba-track"
      role="img"
      :aria-label="aria"
    >
      <div
        class="ba-fill"
        :class="level"
        :style="{ width: solid }"
      />
      <div
        v-if="before !== after"
        class="ba-change"
        :class="grew ? 'added' : 'removed'"
        :style="{ left: changeLeft, width: changeWidth }"
      />
      <ThresholdMarks
        :low="low"
        :target="target"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ba { margin-bottom: 26px; }
.ba-head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; margin-bottom: 6px; }
.ba-label { min-width: 70px; font-weight: bold; }
.ba-pct { min-width: 90px; font-size: 18px; }
.ba-detail { font-size: 14px; }
.ba-track { position: relative; height: 14px; background: var(--border); border-radius: 7px; }
.ba-fill { z-index: 1; position: absolute; left: 0; top: 0; height: 100%; border-radius: 7px 0 0 7px; }
.ba-fill.ok { background: var(--success); }
.ba-fill.under { background: var(--info); }
.ba-fill.over { background: var(--warning); }
.ba-change { z-index: 1; position: absolute; top: 0; height: 100%; border: 1px dashed var(--body-text); box-sizing: border-box; }
.ba-change.removed { background: repeating-linear-gradient(45deg, rgba(128, 128, 128, 0.15), rgba(128, 128, 128, 0.15) 4px, rgba(128, 128, 128, 0.4) 4px, rgba(128, 128, 128, 0.4) 8px); }
.ba-change.added { background: repeating-linear-gradient(45deg, rgba(56, 139, 253, 0.3), rgba(56, 139, 253, 0.3) 4px, rgba(56, 139, 253, 0.7) 4px, rgba(56, 139, 253, 0.7) 8px); }
</style>
