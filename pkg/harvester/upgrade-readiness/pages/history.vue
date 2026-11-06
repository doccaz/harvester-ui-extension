<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { clusterRequest } from '../../utils/cluster-request';
import { SOURCES } from '../utils/sources';
import { TRIM } from '../utils/trim';
import { historyRows } from '../utils/history';
import { useTranslation } from '../../utils/use-translation';
import InfoTip from '../components/InfoTip.vue';
import { setHistoryCount } from '../utils/blockerCount';

// Past upgrades, from the Upgrade records Harvester keeps. Read-only.
const t = useTranslation();
const store = useStore();
const rows = ref([]);
const error = ref('');
const loading = ref(false);
const open = reactive({});
const k = (key, args) => t(`harvester.upgradeReadiness.history.${ key }`, args);
const date = (iso) => (iso ? new Date(iso).toLocaleString([], {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '?');

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const request = clusterRequest(store);
    const [upgrades, images] = await Promise.all([
      request({ url: SOURCES.upgrades }),
      request({ url: SOURCES.images }).catch(() => ({ items: [] })) // names of ISO sources only; optional
    ]);

    rows.value = historyRows(TRIM.upgrades(upgrades), TRIM.images(images));
    setHistoryCount(rows.value.length);
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <div class="upgrade-history">
    <header class="head">
      <h1>{{ k('title') }}</h1>
      <button
        type="button"
        class="btn role-secondary"
        :disabled="loading"
        @click="refresh"
      >
        {{ t('harvester.upgradeReadiness.readiness.recheck') }}
      </button>
    </header>
    <p class="subtitle text-muted">
      {{ k('subtitle') }}
      <InfoTip
        :text="k('footnote')"
        :label="k('footnoteLabel')"
      />
    </p>

    <Banner
      v-if="error"
      color="error"
    >
      {{ error }}
    </Banner>
    <p v-else-if="loading && !rows.length">
      {{ t('harvester.upgradeReadiness.readiness.checking') }}
    </p>
    <p v-else-if="!rows.length">
      {{ k('none') }}
    </p>

    <table
      v-else
      class="history"
    >
      <caption class="sr-only">
        {{ k('title') }}
      </caption>
      <thead>
        <tr>
          <th scope="col">
            {{ k('col.started') }}
          </th>
          <th scope="col">
            {{ k('col.upgrade') }}
          </th>
          <th scope="col">
            {{ k('col.source') }}
          </th>
          <th scope="col">
            {{ k('col.result') }}
          </th>
          <th scope="col">
            {{ k('col.nodes') }}
          </th>
          <th scope="col">
            <span class="sr-only">{{ k('col.details') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="r in rows"
          :key="r.name"
        >
          <tr>
            <td>{{ date(r.started) }}</td>
            <th scope="row">
              {{ r.from }} → {{ r.to }}
            </th>
            <td>{{ r.source === 'iso' ? k('source.iso') : k(`source.${ r.source }`) }}</td>
            <td>
              <span
                class="result"
                :class="r.result"
              >{{ k(`result.${ r.result }`, { state: r.state }) }}</span>
            </td>
            <td>{{ r.nodes.length }}</td>
            <td>
              <button
                type="button"
                class="btn btn-sm role-link"
                :aria-expanded="!!open[r.name]"
                :aria-controls="`details-${ r.name }`"
                @click="open[r.name] = !open[r.name]"
              >
                {{ open[r.name] ? k('hide') : k('show') }}
              </button>
            </td>
          </tr>
          <tr
            v-if="open[r.name]"
            :id="`details-${ r.name }`"
            class="details"
          >
            <td colspan="6">
              <dl>
                <dt>{{ k('d.name') }}</dt>
                <dd><code>{{ r.name }}</code></dd>
                <template v-if="r.iso || r.imageGone">
                  <dt>{{ k('d.iso') }}</dt>
                  <dd>{{ r.iso || k('imageGone') }}</dd>
                </template>
                <template v-if="r.components.kubernetes || r.components.rancher || r.components.os">
                  <dt>{{ k('d.components') }}</dt>
                  <dd>{{ [r.components.os, r.components.kubernetes && `Kubernetes ${ r.components.kubernetes }`, r.components.rancher && `Rancher ${ r.components.rancher }`].filter(Boolean).join(' · ') }}</dd>
                </template>
                <dt>{{ k('d.nodes') }}</dt>
                <dd>{{ r.nodes.map((n) => `${ n.name }: ${ n.state || '?' }${ n.message ? ` (${ n.message })` : '' }`).join(', ') || '—' }}</dd>
                <dt>{{ k('d.options') }}</dt>
                <dd>{{ r.options.map((o) => k(`option.${ o.key }`, o.args)).join(' · ') || k('option.none') }}</dd>
                <template v-if="r.failures.length">
                  <dt>{{ k('d.failures') }}</dt>
                  <dd>{{ r.failures.map((f) => `${ f.type }: ${ f.text }`).join('; ') }}</dd>
                </template>
              </dl>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style lang="scss" scoped>
.upgrade-history { max-width: 1100px; font-size: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; h1 { margin: 0; } }
.subtitle { margin: 4px 0 16px; }
.history {
  width: 100%; border-collapse: collapse;
  th, td { padding: 8px 12px 8px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
  thead th { font-weight: 600; }
  tbody th { font-weight: 600; }
}
.result {
  padding: 0 8px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px;
  &.succeeded { border-color: var(--success); }
  &.failed { border-color: var(--error); }
  &.running { border-color: var(--info); }
}
.details dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.details dt { font-weight: 600; }
.details dd { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
