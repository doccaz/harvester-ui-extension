import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { CONFIG_MAP, POD, WORKLOAD_TYPES } from '@shell/config/types';
import { clusterRequest } from './cluster';
import { podLog, storeName } from './api';
import { buildDryRun, parseDryRunFailure, parseDryRunLog } from './dryrun';

const POD_TIMEOUT_MS = 60000;
const canCreate = (schema) => (schema?.collectionMethods || []).some((m) => m.toUpperCase() === 'POST');

/**
 * Runs the descheduler once in dry-run mode: creates the Job and parses the evictions once the pod has finished. `openLog`
 * shows the pod log in the dashboard's log window.
 */
export function useDryRun() {
  const store = useStore();
  const inStore = storeName(store);
  const run = ref(null); // { name, phase, error, evictions, failure }
  const busy = ref(false);
  let timer;

  const allowed = computed(() => canCreate(store.getters[`${ inStore }/schemaFor`](WORKLOAD_TYPES.JOB)) &&
    canCreate(store.getters[`${ inStore }/schemaFor`](CONFIG_MAP)));
  const pod = computed(() => {
    const name = run.value?.name;

    return name ? store.getters[`${ inStore }/all`](POD).find((p) => p?.metadata?.namespace === 'kube-system' &&
      p?.metadata?.labels?.['job-name'] === name) : null;
  });
  const phase = computed(() => pod.value?.status?.phase || (run.value ? 'Pending' : null));
  const finished = computed(() => phase.value === 'Succeeded' || phase.value === 'Failed');

  async function start(policyYaml, deployment) {
    const request = clusterRequest(store);
    const spec = deployment?.spec?.template?.spec;
    const { name, job, configMap } = buildDryRun(policyYaml, spec?.containers?.[0], spec?.serviceAccountName || undefined);

    busy.value = true;
    clearTimeout(timer);
    run.value = { name };
    try {
      const created = await request({
        url: '/v1/batch.jobs', method: 'post', data: job
      });

      await request({
        url: '/v1/configmaps', method: 'post', data: configMap(created?.metadata?.uid)
      });
      timer = setTimeout(() => {
        if (!pod.value && run.value?.name === name) {
          run.value = { ...run.value, error: 'timeout' };
          busy.value = false;
        }
      }, POD_TIMEOUT_MS);
    } catch (e) {
      run.value = { ...run.value, error: e?.message || e?._statusText || String(e) };
      busy.value = false;
    }
  }

  // Opens the dashboard's log window. Dispatched directly (as the VM model's View Logs does): the Harvester store has no Pod
  // model, so its pods do not have the shell's `openLogs()`.
  function openLog() {
    const p = pod.value;

    if (!p) {
      return;
    }
    store.dispatch('wm/open', {
      id:        `${ p.id }-logs`,
      label:     p.metadata.name,
      icon:      'file',
      component: 'ContainerLogs',
      attrs:     { pod: p, initialContainer: 'descheduler' }
    }, { root: true });
  }

  // The log opens only from View Log (the pod may not exist yet when the run starts); read the result once it has finished.
  watch(() => pod.value?.metadata?.uid, (uid) => uid && clearTimeout(timer));
  watch(finished, async(done) => {
    if (!done || !pod.value) {
      return;
    }
    try {
      const log = await podLog(store, pod.value);

      run.value = {
        ...run.value, evictions: parseDryRunLog(log), failure: parseDryRunFailure(log)
      };
    } catch (e) {
      run.value = { ...run.value, error: e?.message || e?._statusText || String(e) };
    }
    busy.value = false;
  });

  return {
    run, busy, allowed, phase, finished, start, openLog, hasPod: computed(() => !!pod.value)
  };
}
