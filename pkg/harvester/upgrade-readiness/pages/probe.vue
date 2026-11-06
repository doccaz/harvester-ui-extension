<script setup>
import { onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { clusterRequest } from '../utils/cluster';
import {
  FLEET_AGENT_PODS_URL, NODES_URL, PROBES, fleetAgentLogProbe, nodeProbes, runProbe
} from '../utils/probes';
import { useTranslation } from '../utils/i18n';
import { runChecks } from '../utils/checks';
import CheckCard from '../components/CheckCard.vue';
import blocked from '../dev/drift-kubevip-blocked.json';

// DEV ONLY (remove before upstream): preview of the chart drift explainer on the saved 2026-11-06 kube-vip blocked state.
const preview = runChecks({
  managedCharts:     blocked.managedCharts,
  bundleDeployments: blocked.bundleDeployments,
  drift:             {
    live: blocked.live, k3sAddons: blocked.k3sAddons, fleetLog: '', errors: {}
  },
  now: blocked.now
}).find((c) => c.id === 'managedCharts');

// Phase 0 page: lists every API read the upgrade pages will need and whether it works with the user's session.
// Read-only: GETs only.
const t = useTranslation();
const store = useStore();
const results = ref([]);
const running = ref(false);

async function run() {
  running.value = true;
  results.value = [];
  const request = clusterRequest(store);
  const out = await Promise.all(PROBES.map((p) => runProbe(request, p)));

  let names = [];

  try {
    names = ((await request({ url: NODES_URL }))?.items || []).map((n) => n.metadata.name);
  } catch (e) {
    out.push({
      id: 'nodes', need: 'node probes', ok: false, detail: e?.message || String(e)
    });
  }
  out.push(...await Promise.all(nodeProbes(names).map((p) => runProbe(request, p))));

  try {
    const pods = (await request({ url: FLEET_AGENT_PODS_URL }))?.items || [];
    const agent = pods.find((p) => p.metadata.name.startsWith('fleet-agent-') && p.status?.phase === 'Running');

    out.push(agent ? await runProbe(request, fleetAgentLogProbe(agent.metadata.name)) : {
      id: 'fleetAgentLog', need: 'drift freshness', ok: false, detail: 'fleet-agent pod not found'
    });
  } catch (e) {
    out.push({
      id: 'fleetAgentLog', need: 'drift freshness', ok: false, detail: e?.message || String(e)
    });
  }

  results.value = out;
  running.value = false;
  // Machine-readable copy for whoever drives the browser during Phase 0.
  window.__upgradeReadinessProbe = out.map(({
    id, ok, detail, ms
  }) => ({
    id, ok, detail, ms
  }));
}

onMounted(run);
</script>

<template>
  <div class="upgrade-readiness">
    <h1>{{ t('harvester.upgradeReadiness.probe.title') }}</h1>
    <p class="text-muted">
      {{ t('harvester.upgradeReadiness.probe.subtitle') }}
    </p>
    <button
      type="button"
      class="btn role-secondary mb-20"
      :disabled="running"
      @click="run"
    >
      {{ running ? t('harvester.upgradeReadiness.probe.running') : t('harvester.upgradeReadiness.probe.rerun') }}
    </button>
    <p
      v-if="results.length"
      aria-live="polite"
    >
      {{ t('harvester.upgradeReadiness.probe.summary', { ok: results.filter((r) => r.ok).length, total: results.length }) }}
    </p>
    <table class="sortable-table">
      <thead>
        <tr>
          <th>{{ t('harvester.upgradeReadiness.probe.col.result') }}</th>
          <th>{{ t('harvester.upgradeReadiness.probe.col.probe') }}</th>
          <th>{{ t('harvester.upgradeReadiness.probe.col.need') }}</th>
          <th>{{ t('harvester.upgradeReadiness.probe.col.detail') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in results"
          :key="r.id"
        >
          <td :class="r.ok ? 'text-success' : 'text-error'">
            {{ r.ok ? 'OK' : 'FAIL' }}
          </td>
          <td>{{ r.id }}</td>
          <td>{{ r.need }}</td>
          <td>{{ r.detail }}</td>
        </tr>
      </tbody>
    </table>
    <h2 class="mt-40">
      Preview: system chart explainer (saved lab state, 2026-11-06 16:27Z)
    </h2>
    <CheckCard :check="preview" />
  </div>
</template>

<style lang="scss" scoped>
.upgrade-readiness {
  font-size: 14px;

  td, th {
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
}
</style>
