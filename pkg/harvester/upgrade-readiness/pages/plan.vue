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
import { HARVESTER_PRODUCT, PAGES } from '../config/names';

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
const checks = computed(() => (snap.value ? runChecks(snap.value) : []));
const blockers = computed(() => checks.value.filter((c) => c.status === 'block'));
// Per step: 'stall' (VMs cannot move off -> the upgrade will likely stop here), 'action' (VMs to shut down first), 'ok'.
const stepState = (node) => {
  const l = load.value?.[node];

  if (l?.unplaced.length) {
    return 'stall';
  }

  return l?.staying.length ? 'action' : 'ok';
};
const stalls = computed(() => order.value.filter((e) => stepState(e.node) === 'stall'));
const verdict = computed(() => (blockers.value.length || stalls.value.length ? 'fail' : 'ok'));
const blockersLink = computed(() => ({ name: PAGES.readiness.route, params: { product: HARVESTER_PRODUCT, cluster: route.params.cluster || 'local' } }));
const STEP_ICON = {
  ok: 'icon-checkmark', action: 'icon-warning', stall: 'icon-error'
};

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
        class="verdict"
        :class="verdict"
        role="status"
        aria-live="polite"
      >
        <i
          class="icon"
          :class="verdict === 'ok' ? 'icon-checkmark' : 'icon-error'"
          aria-hidden="true"
        />
        <div>
          <b>{{ k(`verdict.${ verdict }`) }}</b>
          <ul
            v-if="verdict === 'fail'"
            class="reasons"
          >
            <li v-if="blockers.length">
              {{ k('verdict.blocked', { n: blockers.length }) }}
              <router-link :to="blockersLink">
                {{ k('verdict.seeBlockers') }}
              </router-link>
            </li>
            <li
              v-for="e in stalls"
              :key="e.node"
            >
              {{ k('verdict.stall', { step: e.position, node: e.node, n: load[e.node].unplaced.length }) }}
            </li>
          </ul>
        </div>
      </div>

      <ol
        class="track"
        :aria-label="k('track')"
      >
        <li class="ok">
          <span class="dot">0</span>
          <span class="name">{{ k('services.short') }}</span>
        </li>
        <li
          v-for="e in order"
          :key="e.node"
          :class="stepState(e.node)"
        >
          <span class="dot">
            <i
              class="icon"
              :class="STEP_ICON[stepState(e.node)]"
              aria-hidden="true"
            />
          </span>
          <span class="name">{{ e.position }}. {{ e.node }}</span>
          <span class="sr-only">{{ k(`state.${ stepState(e.node) }`) }}</span>
        </li>
      </ol>

      <div>
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
          :class="[gate(e.node), stepState(e.node)]"
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
                v-if="stepState(e.node) !== 'ok'"
                class="state"
                :class="stepState(e.node)"
              >{{ k(`state.${ stepState(e.node) }`) }}</span>
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
.verdict {
  display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px; border-left: 4px solid var(--success);
  background: var(--success-banner-bg); font-size: 15px;
  &.fail { border-left-color: var(--error); background: var(--error-banner-bg); }
  .icon { font-size: 20px; margin-top: 2px; }
  &.ok .icon { color: var(--success); }
  &.fail .icon { color: var(--error); }
  .reasons { margin: 4px 0 0; padding-left: 18px; font-size: 14px; }
}
.track {
  display: flex; flex-wrap: wrap; list-style: none; padding: 0; margin: 4px 0 16px; gap: 0;
  li { display: flex; align-items: center; gap: 6px; padding-right: 28px; position: relative; }
  li:not(:last-child)::after { content: ''; position: absolute; right: 6px; top: 50%; width: 16px; border-top: 2px solid var(--border); }
  .dot {
    display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%;
    border: 2px solid var(--success); font-size: 12px; font-weight: bold;
  }
  .ok .icon { color: var(--success); }
  .action .dot { border-color: var(--warning); } .action .icon { color: var(--warning); }
  .stall .dot { border-color: var(--error); } .stall .icon { color: var(--error); }
  .stall .name { font-weight: 600; }
}
.step.stall { border-left: 4px solid var(--error); padding-left: 10px; }
.step.action { border-left: 4px solid var(--warning); padding-left: 10px; }
.state {
  padding: 0 10px; border-radius: 10px; font-size: 12px; border: 1px solid var(--error); font-weight: 600;
  &.action { border-color: var(--warning); }
}
.problem { padding-left: 8px; border-left: 3px solid var(--error); &.warn { border-left-color: var(--warning); } }
.why { margin-top: 16px; summary { cursor: pointer; color: var(--link); } p { margin: 6px 0 0; } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
