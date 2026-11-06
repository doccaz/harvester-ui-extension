import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { NODE, POD } from '@shell/config/types';
import { useTranslation } from './i18n';
import { loadDescheduler, loadNodes, loadPods, storeName } from './api';
import { nodeUsage } from './utilization';

/**
 * The cluster data every page needs (nodes, pods, the add-on and its policy). Nodes and pods come from the dashboard store,
 * which the websocket keeps current, so the numbers stay live without polling. `live: false` (the Simulator) freezes them at
 * load time so they do not move while you edit values; Refresh reloads.
 */
export function useData({ live = true } = {}) {
  const store = useStore();
  const t = useTranslation();
  const inStore = storeName(store);
  const state = ref(null);
  const snapshot = ref({ nodes: [], pods: [] });
  const errors = ref([]);
  const failed = ref([]); // which sources could not be loaded: nodes, pods, descheduler
  const loading = ref(true);
  const updated = ref('');

  async function refresh(force = false) {
    const errs = [];
    const bad = [];
    const guard = async(what, fn, fallback) => {
      try {
        return await fn();
      } catch (e) {
        bad.push(what);
        errs.push(t('harvester.descheduler.error', { what, message: e?.message || e?._statusText || String(e) }));

        return fallback;
      }
    };
    const [nodes, pods, desched] = await Promise.all([
      guard('nodes', () => loadNodes(store, force), []),
      guard('pods', () => loadPods(store, force), []),
      guard('descheduler', () => loadDescheduler(store, force), null)
    ]);

    snapshot.value = { nodes: [...nodes], pods: [...pods] };
    state.value = desched;
    errors.value = errs;
    failed.value = bad;
    updated.value = new Date().toLocaleTimeString();
    loading.value = false;
  }
  onMounted(() => refresh());

  const rawNodes = computed(() => (live && !loading.value ? store.getters[`${ inStore }/all`](NODE) : snapshot.value.nodes));
  const rawPods = computed(() => (live && !loading.value ? store.getters[`${ inStore }/all`](POD) : snapshot.value.pods));
  const usages = computed(() => rawNodes.value.map((n) => nodeUsage(n, rawPods.value)).sort((a, b) => a.name.localeCompare(b.name)));
  // Without nodes and pods there is nothing to measure; showing 0% bars or a verdict would be a lie.
  const dataOk = computed(() => !failed.value.includes('nodes') && !failed.value.includes('pods'));
  const descheduler = computed(() => !failed.value.includes('descheduler'));

  return {
    state, usages, rawNodes, rawPods, errors, failed, loading, updated, refresh: () => refresh(true), dataOk, descheduler
  };
}
