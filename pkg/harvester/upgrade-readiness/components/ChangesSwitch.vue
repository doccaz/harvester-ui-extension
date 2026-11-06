<script setup>
import { changes } from '../utils/actions';
import { useTranslation } from '../utils/i18n';
import InfoTip from './InfoTip.vue';

// Per-session switch for the few writes these pages offer. Off by default and after every reload.
const t = useTranslation();
</script>

<template>
  <div
    class="changes-switch"
    :class="{ on: changes.allowed }"
  >
    <label>
      <input
        v-model="changes.allowed"
        type="checkbox"
      >
      {{ t('harvester.upgradeReadiness.changes.label') }}
    </label>
    <InfoTip
      :text="t(changes.allowed ? 'harvester.upgradeReadiness.changes.enabledHint' : 'harvester.upgradeReadiness.changes.disabledHint')"
      :label="t('harvester.upgradeReadiness.changes.label')"
    />
  </div>
</template>

<style lang="scss" scoped>
.changes-switch {
  display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; margin: 0 0 12px; font-size: 14px;
  label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; font-weight: 600; }
  input { width: 16px; height: 16px; }
  &.on { padding: 6px 10px; border-left: 3px solid var(--warning); }
}
</style>
