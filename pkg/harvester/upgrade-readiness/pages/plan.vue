<script setup>
import {
  computed, onBeforeUnmount, onMounted, ref, watch
} from 'vue';
import { useStore } from 'vuex';
import PlanView from '../components/PlanView.vue';
import { clusterRequest } from '../../utils/cluster-request';
import { loadSnapshot } from '../utils/snapshot';
import { liveStatus } from '../utils/live';
import { useTranslation } from '../../utils/use-translation';

// "Upgrade plan" page: loads the snapshot (GETs only) and, while an upgrade runs, refreshes it every 15 s.
const t = useTranslation();
const store = useStore();
const snap = ref(null);
const loading = ref(false);
const k = (key, args) => t(`harvester.upgradeReadiness.plan.${ key }`, args);

async function refresh() {
  loading.value = true;
  try {
    snap.value = await loadSnapshot(clusterRequest(store), async() => null, { extra: ['planSecrets', 'pods', 'jobs'] });
  } finally {
    loading.value = false;
  }
}

const running = computed(() => !!(snap.value && liveStatus(snap.value)));
let timer = null;

watch(running, (on) => {
  if (on && !timer) {
    timer = setInterval(refresh, 15000);
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
  }
});
onBeforeUnmount(() => timer && clearInterval(timer));
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
    <PlanView
      v-else-if="snap"
      :snap="snap"
    />
  </div>
</template>

<style lang="scss" scoped>
.upgrade-plan { max-width: 1100px; font-size: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; h1 { margin: 0; } }
.subtitle { margin: 4px 0 16px; }
</style>
