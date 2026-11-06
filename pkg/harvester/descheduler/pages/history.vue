<script setup>
import PageHeader from '../components/PageHeader.vue';
import History from '../components/History.vue';
import { useTranslation } from '../utils/i18n';
import { useData } from '../utils/useData';
const t = useTranslation();
// Pods are only needed to find the descheduler pod whose log attributes the migrations.
const { rawPods, errors, loading } = useData();
</script>

<template>
  <div class="descheduler">
    <!-- The History panel has its own Refresh, so the header's is hidden. -->
    <PageHeader
      :title="t('harvester.descheduler.history.title')"
      :subtitle="t('harvester.descheduler.history.subtitle')"
      :errors="errors"
      :show-refresh="false"
    />

    <p v-if="loading">
      {{ t('harvester.descheduler.loading') }}
    </p>

    <History
      v-else
      :pods="rawPods"
    />
  </div>
</template>
