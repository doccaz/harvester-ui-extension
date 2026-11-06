<script setup>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { RcSection } from '@components/RcSection';
import CheckCard from '../components/CheckCard.vue';
import { clusterRequest } from '../utils/cluster';
import { loadSnapshot, SERVING_CERT_ID } from '../utils/snapshot';
import { runChecks, verdict } from '../utils/checks';
import { useTranslation } from '../utils/i18n';

// "Can I upgrade now?": every check of Harvester's upgrade webhook, all at once. Read-only (GETs only).
const t = useTranslation();
const store = useStore();
const results = ref([]);
const loading = ref(false);
const loadedAt = ref(null);
const passedOpen = ref(false);

const storeName = () => store.getters['currentProduct']?.inStore || 'harvester';

/** Expiry of the RKE2 serving cert, parsed by the shell's own Secret model (jsrsasign). */
async function certNotAfter() {
  const secret = await store.dispatch(`${ storeName() }/find`, {
    type: 'secret', id: SERVING_CERT_ID, opt: { force: true }
  });
  const d = secret?.notAfter;

  return d ? new Date(d).toISOString() : null;
}

async function refresh() {
  loading.value = true;
  try {
    results.value = runChecks(await loadSnapshot(clusterRequest(store), certNotAfter));
    loadedAt.value = new Date();
  } finally {
    loading.value = false;
  }
}

const v = computed(() => verdict(results.value));
const problems = computed(() => results.value.filter((r) => ['block', 'warn', 'unknown'].includes(r.status)));
const fine = computed(() => results.value.filter((r) => ['pass', 'skip'].includes(r.status)));
const bannerColor = computed(() => (v.value.block ? 'error' : (v.value.warn || v.value.unknown ? 'warning' : 'success')));

onMounted(refresh);
</script>

<template>
  <div class="upgrade-readiness">
    <header class="head">
      <h1>{{ t('harvester.upgradeReadiness.readiness.title') }}</h1>
      <div class="actions">
        <span
          v-if="loadedAt"
          class="text-muted"
        >{{ t('harvester.upgradeReadiness.readiness.updated', { time: loadedAt.toLocaleTimeString() }) }}</span>
        <button
          type="button"
          class="btn role-secondary"
          :disabled="loading"
          @click="refresh"
        >
          {{ loading ? t('harvester.upgradeReadiness.readiness.checking') : t('harvester.upgradeReadiness.readiness.recheck') }}
        </button>
      </div>
    </header>
    <p class="subtitle text-muted">
      {{ t('harvester.upgradeReadiness.readiness.subtitle') }}
    </p>

    <div
      role="status"
      aria-live="polite"
    >
      <Banner
        v-if="results.length"
        :color="bannerColor"
      >
        <b>{{ v.block ? t('harvester.upgradeReadiness.readiness.blocked', { n: v.block }) : t('harvester.upgradeReadiness.readiness.ready') }}</b>
        <span
          v-if="v.warn || v.unknown"
          class="ml-10"
        >{{ t('harvester.upgradeReadiness.readiness.also', v) }}</span>
      </Banner>
      <p v-else-if="loading">
        {{ t('harvester.upgradeReadiness.readiness.checking') }}
      </p>
    </div>

    <CheckCard
      v-for="c in problems"
      :key="c.id"
      :check="c"
    />

    <RcSection
      v-if="fine.length"
      v-model:expanded="passedOpen"
      type="secondary"
      mode="with-header"
      :expandable="true"
    >
      <template #title>
        <h2 class="passed-title">
          {{ t('harvester.upgradeReadiness.readiness.passed', { n: fine.length }) }}
        </h2>
      </template>
      <ul class="passed">
        <li
          v-for="c in fine"
          :key="c.id"
        >
          <i
            class="icon"
            :class="c.status === 'pass' ? 'icon-checkmark text-success' : 'icon-minus text-muted'"
            aria-hidden="true"
          />
          <span>{{ t(`harvester.upgradeReadiness.check.${ c.id }.title`) }}</span>
          <span class="text-muted">
            {{ c.status === 'pass' ? t(`harvester.upgradeReadiness.check.${ c.id }.ok`, c.args) : t(`harvester.upgradeReadiness.check.${ c.id }.skip`, c.args) }}
          </span>
        </li>
      </ul>
    </RcSection>

    <p class="text-muted footnote">
      {{ t('harvester.upgradeReadiness.readiness.footnote') }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
.upgrade-readiness { max-width: 1100px; font-size: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; h1 { margin: 0; } }
.actions { display: flex; align-items: center; gap: 12px; }
.subtitle { margin: 4px 0 16px; }
.passed-title { font-size: 16px; margin: 0; font-weight: 600; }
.passed {
  list-style: none; padding: 0; margin: 0;
  li { display: flex; gap: 10px; align-items: baseline; padding: 4px 0; flex-wrap: wrap; }
}
.footnote { margin-top: 24px; font-size: 13px; }
</style>
