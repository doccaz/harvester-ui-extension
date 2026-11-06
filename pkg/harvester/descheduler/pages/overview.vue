<script setup>
import { computed } from 'vue';
import { Banner } from '@components/Banner';
import InfoTip from '../components/InfoTip.vue';
import UtilizationBar from '../components/UtilizationBar.vue';
import PageHeader from '../components/PageHeader.vue';
import { useTranslation } from '../utils/i18n';
import { useData } from '../utils/useData';
import { classify, verdict } from '../utils/utilization';
import { formatBytes, formatCores } from '../utils/format';
import { runState } from '../utils/status';
const t = useTranslation();
const {
  state, usages, errors, loading, updated, refresh, dataOk, descheduler
} = useData();
const lno = computed(() => state.value?.policy?.lowNodeUtilization || null);
const result = computed(() => {
  const v = verdict(usages.value, lno.value);

  return state.value?.policyError ? { ...v, key: 'badPolicy' } : v;
});
const bannerColor = computed(() => ({
  noPolicy: 'error', badPolicy: 'error', deviation: 'warning', noUnder: 'info', noOver: 'info', tooFewUnder: 'info', wouldAct: 'warning'
}[result.value.key]));
// One line with host counts, not names: the host cards below already show which host is in which band.
const verdictText = computed(() => t(`harvester.descheduler.verdict.${ result.value.key }`, {
  over:  result.value.over.length,
  under: result.value.under.length,
  max:   state.value?.policy?.maxNoOfPodsToEvictPerNode ?? '?'
}));
const band = (u) => (lno.value ? classify(u, lno.value) : null);
const addon = computed(() => state.value?.addon);
const run = computed(() => runState(state.value?.addon || null, state.value?.deployment || null));
const yesNo = (v) => (v === undefined ? '-' : t(v ? 'harvester.descheduler.policy.yes' : 'harvester.descheduler.policy.no'));
const excludedNamespaces = computed(() => state.value?.policy?.evictableNamespacesExclude || []);
</script>

<template>
  <div class="descheduler">
    <PageHeader
      :title="t('harvester.descheduler.title')"
      :subtitle="t('harvester.descheduler.subtitle')"
      :updated="updated"
      :errors="errors"
      @refresh="refresh"
    />

    <p v-if="loading">
      {{ t('harvester.descheduler.loading') }}
    </p>

    <template v-else>
      <div
        aria-live="polite"
        role="status"
        class="verdict"
      >
        <Banner
          v-if="descheduler && run !== 'running'"
          color="warning"
          :label="t(`harvester.descheduler.run.${ run }`)"
        />
        <Banner
          v-if="dataOk && descheduler"
          :color="bannerColor"
          :label="verdictText"
        />
      </div>

      <div class="summary-section">
        <section
          class="summary-block"
          aria-labelledby="ov-addon"
        >
          <h3
            id="ov-addon"
            class="summary-title"
          >
            {{ t('harvester.descheduler.status.title') }}
          </h3>
          <p
            v-if="!descheduler"
            class="text-muted"
          >
            {{ t('harvester.descheduler.status.unavailable') }}
          </p>
          <p
            v-else-if="!addon"
            class="text-muted"
          >
            {{ t('harvester.descheduler.status.notInstalled') }}
          </p>
          <dl v-else>
            <dt>{{ t('harvester.descheduler.status.enabled') }}</dt>
            <dd>{{ addon.spec?.enabled ? t('harvester.descheduler.status.enabled') : t('harvester.descheduler.status.disabled') }}</dd>
            <dt>{{ t('harvester.descheduler.status.version') }}</dt>
            <dd>{{ addon.spec?.version }}</dd>
            <dt>{{ t('harvester.descheduler.status.state') }}</dt>
            <dd>{{ addon.status?.status }}</dd>
            <dt>{{ t('harvester.descheduler.status.replicas') }}</dt>
            <dd>{{ state?.deployment?.status?.readyReplicas ?? 0 }} / {{ state?.deployment?.status?.replicas ?? 0 }}</dd>
          </dl>
        </section>

        <section
          class="summary-block"
          aria-labelledby="ov-policy"
        >
          <h3
            id="ov-policy"
            class="summary-title"
          >
            {{ t('harvester.descheduler.policy.title') }}
            <InfoTip
              v-if="descheduler"
              :text="t('harvester.descheduler.policy.note')"
            />
          </h3>
          <p
            v-if="!descheduler"
            class="text-muted"
          >
            {{ t('harvester.descheduler.status.unavailable') }}
          </p>
          <Banner
            v-if="state?.policyError"
            color="error"
            :label="t('harvester.descheduler.policy.parseError', { message: state.policyError })"
          />
          <template v-if="state?.policy">
            <Banner
              v-if="lno && !state.policy.lowNodeUtilizationEnabled"
              color="warning"
              :label="t('harvester.descheduler.policy.pluginOff')"
            />
            <dl v-if="lno">
              <dt>{{ t('harvester.descheduler.policy.low') }}</dt>
              <dd>CPU {{ lno.thresholds.cpu ?? '-' }}% / {{ t('harvester.descheduler.nodes.memory') }} {{ lno.thresholds.memory ?? '-' }}%</dd>
              <dt>{{ t('harvester.descheduler.policy.target') }}</dt>
              <dd>CPU {{ lno.targetThresholds.cpu ?? '-' }}% / {{ t('harvester.descheduler.nodes.memory') }} {{ lno.targetThresholds.memory ?? '-' }}%</dd>
              <dt>{{ t('harvester.descheduler.policy.maxEvict') }}</dt>
              <dd>{{ state.policy.maxNoOfPodsToEvictPerNode ?? '-' }}</dd>
              <dt>{{ t('harvester.descheduler.policy.nodeFit') }}</dt>
              <dd>{{ yesNo(state.policy.nodeFit) }}</dd>
              <dt>{{ t('harvester.descheduler.policy.excluded') }}</dt>
              <dd v-if="!excludedNamespaces.length">
                {{ t('harvester.descheduler.policy.none') }}
              </dd>
              <dd v-else>
                <details class="excluded">
                  <summary>{{ t('harvester.descheduler.policy.excludedCount', { count: excludedNamespaces.length }) }}</summary>
                  <ul>
                    <li
                      v-for="ns in excludedNamespaces"
                      :key="ns"
                    >
                      {{ ns }}
                    </li>
                  </ul>
                </details>
              </dd>
            </dl>
          </template>
        </section>
      </div>

      <template v-if="dataOk">
        <h2 class="nodes-title">
          {{ t('harvester.descheduler.nodes.title') }}
          <InfoTip :text="t('harvester.descheduler.nodes.note')" />
        </h2>
        <p
          v-if="lno"
          class="text-muted legend"
        >
          {{ t('harvester.descheduler.nodes.legend') }}
        </p>
        <div class="grid">
          <section
            v-for="u in usages"
            :key="u.name"
            class="card"
            :aria-label="u.name"
          >
            <div class="node-head">
              <h3>{{ u.name }}</h3>
              <span
                v-if="band(u)"
                class="band"
                :class="band(u)"
              >{{ t(`harvester.descheduler.nodes.band.${ band(u) }`) }}</span>
            </div>
            <UtilizationBar
              :label="t('harvester.descheduler.nodes.cpu')"
              :pct="u.cpuPct"
              :low="lno?.thresholds.cpu"
              :target="lno?.targetThresholds.cpu"
              :detail="t('harvester.descheduler.nodes.detail', { used: formatCores(u.requests.cpu), total: formatCores(u.allocatable.cpu) })"
            />
            <UtilizationBar
              :label="t('harvester.descheduler.nodes.memory')"
              :pct="u.memoryPct"
              :low="lno?.thresholds.memory"
              :target="lno?.targetThresholds.memory"
              :detail="t('harvester.descheduler.nodes.detail', { used: formatBytes(u.requests.memory), total: formatBytes(u.allocatable.memory) })"
            />
            <p class="text-muted pods">
              {{ t('harvester.descheduler.nodes.podsCount', { count: u.pods }) }}
            </p>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.verdict :deep(.banner) { font-size: 16px; }

// One bordered strip with the related summaries side by side (Rancher's summary-strip pattern).
.summary-section { display: flex; flex-wrap: wrap; align-items: stretch; border: var(--border-width) solid var(--input-border); border-radius: 6px; margin: 16px 0 24px; }
.summary-block { flex: 1 1 360px; min-width: 0; padding: 16px; }
.summary-block + .summary-block { border-left: var(--border-width) solid var(--input-border); }
.summary-title { margin: 0 0 8px; }
.summary-block p { margin: 0 0 8px; }

.nodes-title { margin: 0 0 8px; }
.legend { margin: 0 0 8px; max-width: 900px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin-top: 12px; }
.card { border: var(--border-width) solid var(--border); border-radius: var(--border-radius); padding: 16px; background: var(--box-bg); }
.node-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
.node-head h3 { margin: 0; }
.band { padding: 2px 10px; border-radius: 10px; font-size: 14px; white-space: nowrap; }
.band.under { background: var(--info); color: var(--info-text); }
.band.appropriate { background: var(--success); color: var(--success-text); }
.band.over { background: var(--warning); color: var(--warning-text); }
.pods { margin: 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: 16px; }
dt { color: var(--muted); }
dd { margin: 0; }
.excluded summary { cursor: pointer; }
.excluded ul { margin: 8px 0 0; padding-left: 20px; }
</style>
