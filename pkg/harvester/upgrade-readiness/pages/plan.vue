<script setup>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { Banner } from '@components/Banner';
import { clusterRequest } from '../utils/cluster';
import { loadSnapshot } from '../utils/snapshot';
import { runChecks } from '../utils/checks';
import { moveLoad, pausePlan, planNotes, predictOrder } from '../utils/plan';
import { useTranslation } from '../utils/i18n';
import { HARVESTER_PRODUCT } from '../config/names';

// "Upgrade plan": node order, where the upgrade will wait for you, and what happens to each node's VMs. Read-only.
const t = useTranslation();
const store = useStore();
const route = useRoute();
const snap = ref(null);
const loading = ref(false);
const k = (key, args) => t(`harvester.upgradeReadiness.plan.${ key }`, args);
const GIB = 2 ** 30;
const gib = (b) => (b / GIB).toFixed(1);

async function refresh() {
  loading.value = true;
  try {
    snap.value = await loadSnapshot(clusterRequest(store), async() => null, { extra: ['planSecrets', 'pods'] });
  } finally {
    loading.value = false;
  }
}

const missing = computed(() => ['machines', 'planSecrets', 'nodes', 'upgradeConfig', 'upgrades'].filter((key) => snap.value?.errors?.[key]));
const order = computed(() => (snap.value && !missing.value.length ? predictOrder(snap.value.machines, snap.value.planSecrets, snap.value.nodes) : []));
const pause = computed(() => (snap.value && !missing.value.length ? pausePlan(snap.value.upgradeConfig, snap.value.nodes, snap.value.upgrades) : null));
const notes = computed(() => (pause.value ? planNotes(order.value, pause.value) : []));
// VMs that cannot live-migrate are shut down, not moved: same rule as the pre-flight check.
const stay = computed(() => new Set(snap.value ? (runChecks(snap.value).find((c) => c.id === 'nonMigratable')?.items || []).map((i) => i.text) : []));
const load = computed(() => (snap.value?.pods && snap.value?.nodes ? moveLoad(snap.value.nodes, snap.value.pods, stay.value) : null));
const gate = (node) => (pause.value?.released.includes(node) ? 'released' : (pause.value?.paused.includes(node) ? 'waits' : 'noStop'));

const bannerText = computed(() => {
  const p = pause.value;

  if (!p) {
    return '';
  }
  if (p.source === 'upgrade') {
    return k('mode.running', { upgrade: p.upgrade, n: p.paused.length });
  }

  return p.mode === 'manual' ? k('mode.manual', { n: p.paused.length }) : k('mode.auto');
});

const settingLink = computed(() => ({
  name:   `${ HARVESTER_PRODUCT }-c-cluster-resource-id`,
  params: {
    product: HARVESTER_PRODUCT, cluster: route.params.cluster || 'local', resource: 'harvesterhci.io.setting', id: 'upgrade-config'
  },
  query: { mode: 'edit' }
}));
const hostLink = (node) => ({
  name:   `${ HARVESTER_PRODUCT }-c-cluster-resource-id`,
  params: {
    product: HARVESTER_PRODUCT, cluster: route.params.cluster || 'local', resource: 'harvesterhci.io.host', id: node
  }
});

onMounted(refresh);
</script>

<template>
  <div class="upgrade-plan">
    <header class="head">
      <h1>{{ k('title') }}</h1>
      <button
        type="button"
        class="btn role-secondary"
        :disabled="loading"
        @click="refresh"
      >
        {{ loading ? t('harvester.upgradeReadiness.readiness.checking') : t('harvester.upgradeReadiness.readiness.recheck') }}
      </button>
    </header>
    <p class="subtitle text-muted">
      {{ k('subtitle') }}
    </p>

    <p v-if="loading && !snap">
      {{ t('harvester.upgradeReadiness.readiness.checking') }}
    </p>
    <Banner
      v-else-if="missing.length"
      color="warning"
    >
      {{ t('harvester.upgradeReadiness.unknown', { sources: missing.join(', ') }) }}
    </Banner>

    <template v-else-if="pause">
      <div
        role="status"
        aria-live="polite"
      >
        <Banner :color="pause.mode === 'manual' ? 'info' : 'secondary'">
          <span>{{ bannerText }}</span>
          <router-link
            v-if="pause.source === 'setting'"
            class="ml-10"
            :to="settingLink"
          >
            {{ k('changePause') }}
          </router-link>
        </Banner>
      </div>
      <ul
        v-if="notes.length"
        class="notes"
      >
        <li
          v-for="n in notes"
          :key="n.key"
        >
          {{ k(`note.${ n.key }`, n.args) }}
        </li>
      </ul>

      <ol class="steps">
        <li class="step services">
          <span
            class="num"
            aria-hidden="true"
          >0</span>
          <div class="body">
            <h2>{{ k('services.title') }}</h2>
            <p class="text-muted">
              {{ k('services.text') }}
            </p>
          </div>
        </li>
        <li
          v-for="e in order"
          :key="e.node"
          class="step"
          :class="gate(e.node)"
        >
          <span
            class="num"
            aria-hidden="true"
          >{{ e.position }}</span>
          <div class="body">
            <div class="line">
              <h2>
                <span class="sr-only">{{ k('stepNo', { n: e.position }) }}</span>
                <router-link :to="hostLink(e.node)">
                  {{ e.node }}
                </router-link>
              </h2>
              <span
                v-if="e.init"
                class="tag"
              >{{ k('tag.init') }}</span>
              <span
                v-if="e.witness"
                class="tag"
              >{{ k('tag.witness') }}</span>
              <span
                v-if="e.roles.etcd"
                class="tag"
              >etcd</span>
              <span
                v-if="e.roles.cp"
                class="tag"
              >{{ k('tag.cp') }}</span>
              <span
                class="gate"
                :class="gate(e.node)"
              >{{ k(`gate.${ gate(e.node) }`) }}</span>
            </div>
            <template v-if="load && load[e.node]">
              <p v-if="load[e.node].moving.length">
                {{ k('vms.moving', { n: load[e.node].moving.length, gib: gib(load[e.node].totalBytes), targets: load[e.node].targets.join(', ') || '—' }) }}
              </p>
              <p
                v-else-if="!load[e.node].staying.length"
                class="text-muted"
              >
                {{ k('vms.none') }}
              </p>
              <p
                v-if="load[e.node].staying.length"
                class="problem"
              >
                <b>{{ k('label.action') }}</b> {{ k('vms.staying', { vms: load[e.node].staying.map((v) => v.vm).join(', ') }) }}
              </p>
              <p
                v-if="load[e.node].unplaced.length"
                class="problem warn"
              >
                <b>{{ k('label.risk') }}</b> {{ k('vms.unplaced', { targets: load[e.node].targets.join(', ') || '—', vms: load[e.node].unplaced.map((v) => `${ v.vm } (${ gib(v.memory) } GiB)`).join(', ') }) }}
              </p>
            </template>
          </div>
        </li>
      </ol>

      <details class="why">
        <summary>{{ k('why.summary') }}</summary>
        <p>{{ k('why.text') }}</p>
      </details>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.upgrade-plan { max-width: 1100px; font-size: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; h1 { margin: 0; } }
.subtitle { margin: 4px 0 16px; }
.notes { margin: 8px 0 16px; padding-left: 20px; li { margin: 4px 0; } }
.steps { list-style: none; padding: 0; margin: 0; }
.step {
  display: flex; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--border);
  h2 { font-size: 16px; margin: 0; font-weight: 600; }
  p { margin: 4px 0 0; }
}
.num {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: var(--primary-text); font-weight: bold;
}
.services .num { background: var(--border); color: var(--body-text); }
.body { flex: 1; }
.line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tag { padding: 0 8px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; }
.gate {
  margin-left: auto; padding: 0 10px; border-radius: 10px; font-size: 12px; border: 1px solid var(--border);
  &.waits { border-color: var(--warning); }
  &.released { border-color: var(--success); }
}
.problem { padding-left: 8px; border-left: 3px solid var(--error); &.warn { border-left-color: var(--warning); } }
.why { margin-top: 16px; summary { cursor: pointer; color: var(--link); } p { margin: 6px 0 0; } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
