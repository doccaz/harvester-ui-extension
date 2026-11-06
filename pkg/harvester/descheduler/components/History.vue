<script setup>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import SortableTable from '@shell/components/SortableTable';
import { useTranslation } from '../utils/i18n';
import { loadHistory } from '../utils/api';
import { countBy } from '../utils/moves';
const props = defineProps({ pods: { type: Array, required: true } });
const store = useStore();
const t = useTranslation();
const state = ref(null);
const error = ref('');
const when = (ms) => new Date(ms).toLocaleString();

async function load(force = false) {
  try {
    state.value = await loadHistory(store, props.pods, force);
    error.value = '';
  } catch (e) {
    error.value = t('harvester.descheduler.error', { what: 'migrations', message: e?.message || e?._statusText || String(e) });
  }
}
onMounted(() => load());
// KubeVirt keeps every migration record, so the list can be long: a sortable, searchable, paged table, newest first.
const rows = computed(() => (state.value?.rows || []).map((r) => ({
  ...r,
  _key:  `${ r.namespace }/${ r.name }`,
  when:  when(r.created),
  vmRef: `${ r.namespace }/${ r.vm }`,
  route: `${ r.from || '?' } → ${ r.to || '?' }`,
  cause: t(`harvester.descheduler.history.kind.${ r.kind }`)
})));
const headers = [
  {
    name: 'when', labelKey: 'harvester.descheduler.history.col.when', value: 'when', sort: ['created'], width: 190
  },
  {
    name: 'vm', labelKey: 'harvester.descheduler.history.col.vm', value: 'vmRef', sort: ['vmRef']
  },
  {
    name: 'route', labelKey: 'harvester.descheduler.history.col.route', value: 'route', sort: ['route'], width: 220
  },
  {
    name: 'cause', labelKey: 'harvester.descheduler.history.col.cause', value: 'cause', sort: ['cause']
  },
  {
    name: 'result', labelKey: 'harvester.descheduler.history.col.result', value: 'phase', sort: ['phase'], width: 160
  }
];
const kinds = computed(() => countBy(rows.value, (r) => r.kind));
</script>

<template>
  <section class="history">
    <div class="head">
      <p class="text-muted">
        {{ t('harvester.descheduler.history.note') }}
      </p>
      <button
        class="btn role-secondary"
        @click="load(true)"
      >
        {{ t('harvester.descheduler.refresh') }}
      </button>
    </div>
    <Banner
      v-if="error"
      color="error"
      :label="error"
    />
    <template v-if="state">
      <Banner
        v-if="state.logError"
        color="warning"
        :label="t('harvester.descheduler.history.noLog', { message: state.logError })"
      />
      <p
        v-else-if="state.activity.cycles"
        class="text-muted"
      >
        {{ t('harvester.descheduler.history.activity', {
          cycles: state.activity.cycles, from: when(state.activity.from), to: when(state.activity.to),
          requests: state.activity.evictionRequests, evicted: state.activity.evictedPods
        }) }}
      </p>

      <p v-if="!rows.length">
        {{ t('harvester.descheduler.history.empty') }}
      </p>
      <template v-else>
        <ul
          class="kinds"
          :aria-label="t('harvester.descheduler.history.kindsLabel')"
        >
          <li
            v-for="k in kinds"
            :key="k.key"
            class="kind"
            :class="k.key"
          >
            {{ t(`harvester.descheduler.history.kind.${ k.key }`) }}: {{ k.count }}
          </li>
        </ul>

        <SortableTable
          :rows="rows"
          :headers="headers"
          key-field="_key"
          default-sort-by="when"
          :descending="true"
          :search="true"
          :table-actions="false"
          :row-actions="false"
          :groupable="false"
          :paging="true"
          :rows-per-page="10"
        >
          <template #col:cause="{ row }">
            <td>
              <span
                class="kind"
                :class="row.kind"
              >{{ row.cause }}</span>
              <div class="text-muted why">
                {{ t(`harvester.descheduler.history.why.${ row.kind }`, { node: row.evacuatedNode }) }}
              </div>
            </td>
          </template>
          <template #col:result="{ row }">
            <td>
              {{ row.phase }}<template v-if="row.seconds !== undefined">
                ({{ t('harvester.descheduler.history.took', { seconds: row.seconds }) }})
              </template>
              <div
                v-if="row.failure"
                class="text-error"
              >
                {{ t('harvester.descheduler.history.failed', { reason: row.failure }) }}
              </div>
            </td>
          </template>
        </SortableTable>
      </template>
    </template>
  </section>
</template>

<style lang="scss" scoped>
.history { border: var(--border-width) solid var(--border); border-radius: var(--border-radius); padding: 24px; margin-top: 16px; background: var(--box-bg); }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.head p { margin: 0; }
.kinds { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 12px 0 16px; }
.kind { padding: 2px 10px; border-radius: 10px; font-size: 14px; white-space: nowrap; }
.kind.descheduler { background: var(--warning); color: var(--warning-text); }
.kind.evacuation { background: var(--info); color: var(--info-text); }
// "Unverified" keeps the full-contrast colours and is marked with a dashed outline instead of fading the text.
.kind.evacuationUnverified { background: var(--info); color: var(--info-text); outline: 2px dashed var(--info-text); outline-offset: -3px; }
.kind.manual { background: var(--success); color: var(--success-text); }
.why { font-size: 14px; margin-top: 4px; max-width: 520px; }
</style>
