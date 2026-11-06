<script setup>
import { changed, changes, forget } from '../utils/actions';
import { useTranslation } from '../utils/i18n';
import ConfirmAction from './ConfirmAction.vue';

// What was changed from these pages and should be undone after the upgrade (kept in this browser only).
const t = useTranslation();
const when = (iso) => new Date(iso).toLocaleString([], {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});
</script>

<template>
  <section
    v-if="changed.list.length"
    class="changed"
  >
    <h2>{{ t('harvester.upgradeReadiness.changed.title') }}</h2>
    <p class="text-muted">
      {{ t('harvester.upgradeReadiness.changed.subtitle') }}
    </p>
    <ul>
      <li
        v-for="c in changed.list"
        :key="`${ c.kind }-${ c.target }`"
      >
        <span>{{ t(`harvester.upgradeReadiness.changed.${ c.kind }`, { target: c.target }) }}</span>
        <span class="text-muted">{{ when(c.at) }}</span>
        <ConfirmAction
          :kind="c.undo"
          :target="c.target"
          :label="t(`harvester.upgradeReadiness.action.label.${ c.undo }`)"
          @done="forget(c)"
        />
        <button
          v-if="changes.allowed"
          type="button"
          class="btn btn-sm role-link"
          @click="forget(c)"
        >
          {{ t('harvester.upgradeReadiness.changed.forget') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style lang="scss" scoped>
.changed { margin: 16px 0; padding: 10px 14px; border-left: 3px solid var(--warning); h2 { font-size: 16px; margin: 0; } ul { padding-left: 18px; margin: 6px 0 0; } li { margin: 4px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } }
</style>
