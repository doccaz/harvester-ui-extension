<script setup>
import { computed } from 'vue';
import { Banner } from '@components/Banner';
import Simulator from '../components/Simulator.vue';
import PageHeader from '../components/PageHeader.vue';
import { useTranslation } from '../utils/i18n';
import { useData } from '../utils/useData';
import { runState } from '../utils/status';
const t = useTranslation();
// Frozen at load time: the numbers must not move while you are editing values. Refresh reloads them.
const {
  state, rawNodes, rawPods, errors, loading, updated, refresh, dataOk, descheduler
} = useData({ live: false });
const run = computed(() => runState(state.value?.addon || null, state.value?.deployment || null));
</script>

<template>
  <div class="descheduler">
    <PageHeader
      :title="t('harvester.descheduler.simulator.title')"
      :subtitle="t('harvester.descheduler.simulator.subtitle')"
      :updated="updated"
      :errors="errors"
      @refresh="refresh"
    />

    <p v-if="loading">
      {{ t('harvester.descheduler.loading') }}
    </p>

    <template v-else>
      <Banner
        v-if="descheduler && run !== 'running'"
        color="warning"
        :label="t(`harvester.descheduler.run.${ run }`)"
      />

      <Simulator
        v-if="dataOk"
        :nodes="rawNodes"
        :pods="rawPods"
        :policy="state?.policy || null"
        :policy-raw="state?.policyRaw || null"
        :deployment="state?.deployment || null"
      />
    </template>
  </div>
</template>
