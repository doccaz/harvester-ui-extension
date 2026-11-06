<script setup>
import {
  computed, onBeforeUnmount, onMounted, ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import SortableTable from '@shell/components/SortableTable';
import { useTranslation } from '../utils/i18n';
import { simulate } from '../utils/simulate';
import { buildPolicyYaml } from '../utils/dryrun';
import { loadNamespaces } from '../utils/api';
import { useDryRun } from '../utils/useDryRun';
import NodeBeforeAfter from './NodeBeforeAfter.vue';
import StepHeader from './StepHeader.vue';
import InfoTip from './InfoTip.vue';
import { routeCounts } from '../utils/moves';
import { simulateRange } from '../utils/range';
import { invalidNamespaces, namespaceOptions, sameSet } from '../utils/namespaces';
import { formatBytes, formatCores } from '../utils/format';
const props = defineProps({
  nodes:      { type: Array, required: true },
  pods:       { type: Array, required: true },
  policy:     { type: Object, default: null },
  policyRaw:  { type: String, default: null },
  deployment: { type: Object, default: null }
});
const t = useTranslation();
const store = useStore();
const form = ref({
  lowCpu: 30, lowMem: 30, targetCpu: 50, targetMem: 50, maxPerNode: 5, nodeFit: true, excluded: []
});

function reset() {
  const lno = props.policy?.lowNodeUtilization;

  form.value = {
    lowCpu:     lno?.thresholds.cpu ?? 30,
    lowMem:     lno?.thresholds.memory ?? 30,
    targetCpu:  lno?.targetThresholds.cpu ?? 50,
    targetMem:  lno?.targetThresholds.memory ?? 50,
    maxPerNode: props.policy?.maxNoOfPodsToEvictPerNode ?? 0,
    nodeFit:    props.policy?.nodeFit ?? true,
    excluded:   [...(props.policy?.evictableNamespacesExclude || [])]
  };
}
// Seed once when the active policy first arrives; never overwrite the user's edits on the 30 s refresh.
let seeded = false;

watch(() => props.policy, (p) => {
  if (p && !seeded) {
    seeded = true;
    reset();
  }
}, { immediate: true });
// Namespaces come from the cluster so a name cannot be mistyped; if the list cannot be loaded, typing new names is allowed (and checked).
const clusterNamespaces = ref([]);
const nsFailed = ref(false);

onMounted(async() => {
  try {
    clusterNamespaces.value = await loadNamespaces(store);
  } catch (e) {
    nsFailed.value = true;
  }
});
const nsOptions = computed(() => namespaceOptions(clusterNamespaces.value, form.value.excluded));
const excluded = computed(() => form.value.excluded);
const badNamespaces = computed(() => invalidNamespaces(excluded.value));
// The form as the other parts (dry run, apply) see it: the namespaces text turned into a list.
const applyForm = computed(() => ({
  lowCpu:     form.value.lowCpu,
  lowMem:     form.value.lowMem,
  targetCpu:  form.value.targetCpu,
  targetMem:  form.value.targetMem,
  maxPerNode: form.value.maxPerNode,
  nodeFit:    form.value.nodeFit,
  excluded:   excluded.value
}));

// One simulation run for a given set of form values; `order` replays the picks of a real run among VMs of equal priority and QoS.
function simInput(f, order) {
  return {
    thresholds: {
      thresholds:       { cpu: Number(f.lowCpu), memory: Number(f.lowMem) },
      targetThresholds: { cpu: Number(f.targetCpu), memory: Number(f.targetMem) },
      numberOfNodes:    props.policy?.lowNodeUtilization?.numberOfNodes
    },
    options: {
      maxPerNode: Number(f.maxPerNode), nodeFit: f.nodeFit, excluded: f.excluded, order
    }
  };
}

function runSimulation(f, order) {
  const i = simInput(f, order);

  return simulate(props.nodes, props.pods, i.thresholds, i.options);
}
const sim = computed(() => runSimulation(form.value));
// One run is only ONE possible outcome: equal VMs are tried in no particular order. The range says what else can happen.
// It costs up to 200 simulation runs, so it is computed once the values have stopped changing, not on every keystroke.
const settledForm = ref(null);
let settleTimer;

watch(form, (f) => {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settledForm.value = { ...f, excluded: [...f.excluded] };
  }, 400);
}, { deep: true, immediate: true });
onBeforeUnmount(() => clearTimeout(settleTimer));
const range = computed(() => {
  if (!settledForm.value || !runSimulation(settledForm.value).evictions.length) {
    return null;
  }
  const i = simInput(settledForm.value);

  return simulateRange(props.nodes, props.pods, i.thresholds, i.options);
});
const varies = computed(() => !!range.value && range.value.max > range.value.min);
const thresholds = computed(() => ({
  thresholds:       { cpu: Number(form.value.lowCpu), memory: Number(form.value.lowMem) },
  targetThresholds: { cpu: Number(form.value.targetCpu), memory: Number(form.value.targetMem) }
}));
const cards = computed(() => sim.value.before.map((b) => ({
  before: b,
  after:  sim.value.after.find((a) => a.name === b.name) || b,
  out:    sim.value.evictions.filter((e) => e.from === b.name),
  inn:    sim.value.evictions.filter((e) => e.to === b.name)
})));
const changed = computed(() => {
  const lno = props.policy?.lowNodeUtilization;
  const f = form.value;

  return !lno || lno.thresholds.cpu !== Number(f.lowCpu) || lno.thresholds.memory !== Number(f.lowMem) ||
        lno.targetThresholds.cpu !== Number(f.targetCpu) || lno.targetThresholds.memory !== Number(f.targetMem) ||
        !sameSet(excluded.value, props.policy?.evictableNamespacesExclude || []);
});
const color = computed(() => {
  if (sim.value.reason === 'invalidThresholds') {
    return 'error';
  }

  return sim.value.evictions.length ? 'warning' : 'info';
});
const summary = computed(() => {
  if (!sim.value.evictions.length) {
    return t(`harvester.descheduler.simulator.result.${ sim.value.reason }`);
  }
  if (range.value && varies.value) {
    return t(`harvester.descheduler.simulator.result.${ range.value.exact ? 'range' : 'rangeApprox' }`, { min: range.value.min, max: range.value.max });
  }

  return t('harvester.descheduler.simulator.result.moves', { count: sim.value.evictions.length });
});
// The moves as table rows. A cluster can send many VMs at once, so they go in a sortable, searchable, paged table.
const evictionRows = computed(() => sim.value.evictions.map((e) => ({
  _key:   e.pod,
  vm:     `${ e.namespace }/${ e.vm }`,
  from:   e.from,
  to:     e.to || '?',
  cpu:    e.requests.cpu,
  memory: e.requests.memory,
  size:   `${ formatCores(e.requests.cpu) }, ${ formatBytes(e.requests.memory) }`
})));
const evictionHeaders = [
  {
    name: 'vm', labelKey: 'harvester.descheduler.simulator.vm', value: 'vm', sort: ['vm']
  },
  {
    name: 'from', labelKey: 'harvester.descheduler.simulator.from', value: 'from', sort: ['from', 'vm'], width: 180
  },
  {
    name: 'to', labelKey: 'harvester.descheduler.simulator.to', value: 'to', sort: ['to', 'vm'], width: 180
  },
  {
    name: 'size', labelKey: 'harvester.descheduler.simulator.size', value: 'size', sort: ['cpu', 'memory'], width: 220
  }
];
const routes = computed(() => routeCounts(sim.value.evictions));
const possible = computed(() => Object.entries(range.value?.possible || {}).map(([node, names]) => ({
  node,
  count:     names.length,
  always:    names.filter((n) => range.value?.certain.includes(n)),
  sometimes: names.filter((n) => !range.value?.certain.includes(n))
})));
const skippedText = (s) => `${ s.vm }: ${ t(`harvester.descheduler.simulator.why.${ s.why }`) }`;
// --- dry run: the real descheduler, once, with the values above ---
const dryRun = useDryRun();
const dryRunError = ref('');
const dryRunPredicted = ref(0);

async function startDryRun() {
  dryRunError.value = '';
  try {
    if (!props.policyRaw || !props.deployment) {
      throw new Error(t('harvester.descheduler.dryRun.missing'));
    }
    dryRunPredicted.value = sim.value.evictions.length;
    await dryRun.start(buildPolicyYaml(props.policyRaw, { ...applyForm.value }), props.deployment);
  } catch (e) {
    dryRunError.value = e?.message || String(e);
  }
}
const dryRunResult = computed(() => {
  const r = dryRun.run.value;

  if (!r) {
    return null;
  }
  if (r.error) {
    return { color: 'error', label: r.error === 'timeout' ? t('harvester.descheduler.dryRun.timeout') : t('harvester.descheduler.dryRun.error', { message: r.error }) };
  }
  if (r.failure) {
    return { color: 'error', label: t('harvester.descheduler.dryRun.failed', { message: r.failure }) };
  }
  if (r.evictions) {
    return {
      color: r.evictions.length ? 'warning' : 'success',
      label: t('harvester.descheduler.dryRun.result', { count: r.evictions.length, predicted: dryRunPredicted.value })
    };
  }

  return { color: 'info', label: t('harvester.descheduler.dryRun.running', { name: r.name, phase: dryRun.phase.value }) };
});
</script>

<template>
  <div class="steps">
    <section
      class="step"
      aria-labelledby="sim-step1"
    >
      <StepHeader
        id="sim-step1"
        :step="1"
        :title="t('harvester.descheduler.steps.settings')"
        :info="t('harvester.descheduler.simulator.note')"
      />

      <div class="form">
        <label>{{ t('harvester.descheduler.policy.low') }} CPU %<input
          v-model.number="form.lowCpu"
          type="number"
          min="0"
          max="100"
        ></label>
        <label>{{ t('harvester.descheduler.policy.low') }} {{ t('harvester.descheduler.nodes.memory') }} %<input
          v-model.number="form.lowMem"
          type="number"
          min="0"
          max="100"
        ></label>
        <label>{{ t('harvester.descheduler.policy.target') }} CPU %<input
          v-model.number="form.targetCpu"
          type="number"
          min="0"
          max="100"
        ></label>
        <label>{{ t('harvester.descheduler.policy.target') }} {{ t('harvester.descheduler.nodes.memory') }} %<input
          v-model.number="form.targetMem"
          type="number"
          min="0"
          max="100"
        ></label>
        <label>{{ t('harvester.descheduler.policy.maxEvict') }}<input
          v-model.number="form.maxPerNode"
          type="number"
          min="0"
        ></label>
        <label class="check"><input
          v-model="form.nodeFit"
          type="checkbox"
        > {{ t('harvester.descheduler.policy.nodeFit') }}</label>
        <div class="ns">
          <LabeledSelect
            v-model:value="form.excluded"
            :label="t('harvester.descheduler.simulator.excluded')"
            :options="nsOptions"
            :multiple="true"
            :taggable="nsFailed"
            :searchable="true"
            :close-on-select="false"
            :loading="!nsFailed && !clusterNamespaces.length"
          />
        </div>
      </div>
      <Banner
        v-if="badNamespaces.length"
        color="error"
        :label="t('harvester.descheduler.simulator.badNamespaces', { list: badNamespaces.join(', ') })"
      />
      <div class="form-foot">
        <button
          class="btn role-secondary"
          :disabled="!policy"
          @click="reset"
        >
          {{ t('harvester.descheduler.simulator.reset') }}
        </button>
        <span
          v-if="changed"
          class="text-muted"
        >{{ t('harvester.descheduler.simulator.changed') }}</span>
      </div>
    </section>

    <section
      class="step"
      aria-labelledby="sim-step2"
    >
      <StepHeader
        id="sim-step2"
        :step="2"
        :title="t('harvester.descheduler.steps.move')"
        :info="t('harvester.descheduler.steps.moveHint')"
      />

      <div
        role="status"
        aria-live="polite"
        class="result"
      >
        <Banner
          :color="color"
          :label="summary"
        />
      </div>
      <ul
        v-if="routes.length"
        class="routes"
        :aria-label="t('harvester.descheduler.simulator.routesLabel')"
      >
        <li
          v-for="r in routes"
          :key="`${ r.from }-${ r.to }`"
          class="route"
        >
          {{ t('harvester.descheduler.simulator.route', { from: r.from, to: r.to, count: r.count }) }}
        </li>
      </ul>

      <h3 class="sub-title">
        {{ t('harvester.descheduler.simulator.nodes.title') }}
        <InfoTip :text="t('harvester.descheduler.simulator.nodes.note')" />
      </h3>
      <div class="node-grid">
        <NodeBeforeAfter
          v-for="c in cards"
          :key="c.before.name"
          :before="c.before"
          :after="c.after"
          :thresholds="thresholds"
          :out="c.out"
          :inn="c.inn"
        />
      </div>

      <SortableTable
        v-if="evictionRows.length"
        class="evictions"
        :rows="evictionRows"
        :headers="evictionHeaders"
        key-field="_key"
        :search="evictionRows.length > 10"
        :table-actions="false"
        :row-actions="false"
        :groupable="false"
        :paging="true"
        :rows-per-page="10"
      >
        <template #header-left>
          <h3 class="sub-title">
            {{ t(varies ? 'harvester.descheduler.simulator.exampleTitle' : 'harvester.descheduler.simulator.movesTitle', { count: evictionRows.length }) }}
            <InfoTip :text="t('harvester.descheduler.simulator.tieNote')" />
          </h3>
        </template>
      </SortableTable>

      <details
        v-for="p in possible"
        :key="p.node"
        class="fold"
      >
        <summary>{{ t('harvester.descheduler.simulator.possibleSummary', { node: p.node, count: p.count }) }}</summary>
        <p v-if="p.always.length">
          {{ t('harvester.descheduler.simulator.always', { list: p.always.join(', ') }) }}
        </p>
        <p v-if="p.sometimes.length">
          {{ t('harvester.descheduler.simulator.sometimes', { list: p.sometimes.join(', ') }) }}
        </p>
      </details>
      <details
        v-if="sim.skipped.length"
        class="fold"
      >
        <summary>{{ t('harvester.descheduler.simulator.skippedSummary', { count: sim.skipped.length }) }}</summary>
        <ul>
          <li
            v-for="sk in sim.skipped"
            :key="sk.vm"
          >
            {{ skippedText(sk) }}
          </li>
        </ul>
      </details>
    </section>

    <section
      class="step"
      aria-labelledby="sim-step3"
    >
      <StepHeader
        id="sim-step3"
        :step="3"
        :title="t('harvester.descheduler.dryRun.title')"
        :info="t('harvester.descheduler.dryRun.note')"
      />
      <p class="text-muted">
        {{ t('harvester.descheduler.dryRun.description') }}
      </p>
      <div class="dry-run-actions">
        <button
          class="btn"
          :class="dryRun.hasPod.value ? 'role-secondary' : 'role-primary'"
          :disabled="!dryRun.allowed.value || dryRun.busy.value || sim.reason === 'invalidThresholds'"
          @click="startDryRun"
        >
          {{ t('harvester.descheduler.dryRun.start') }}
        </button>
        <button
          v-if="dryRun.hasPod.value"
          class="btn role-primary"
          @click="dryRun.openLog"
        >
          {{ t('harvester.descheduler.dryRun.viewLog') }}
        </button>
        <span
          v-if="!dryRun.allowed.value"
          class="text-muted"
        >{{ t('harvester.descheduler.dryRun.noPermission') }}</span>
      </div>
      <div aria-live="polite">
        <Banner
          v-if="dryRunError"
          color="error"
          :label="dryRunError"
        />
        <Banner
          v-if="dryRunResult"
          :color="dryRunResult.color"
          :label="dryRunResult.label"
        />
        <ul
          v-if="dryRun.run.value?.evictions?.length"
          class="dry-run-evictions"
        >
          <li
            v-for="e in dryRun.run.value.evictions"
            :key="e.pod"
          >
            {{ t('harvester.descheduler.dryRun.eviction', { pod: e.pod, node: e.node }) }}
          </li>
        </ul>
      </div>
    </section>

    <p class="text-muted caveat">
      {{ t('harvester.descheduler.simulator.caveatShort') }}
      <InfoTip :text="t('harvester.descheduler.simulator.caveat')" />
    </p>
  </div>
</template>

<style lang="scss" scoped>
.steps { display: flex; flex-direction: column; gap: var(--gap-lg, 24px); margin-top: 16px; }
.step { border: var(--border-width) solid var(--border); border-radius: var(--border-radius); padding: 24px; background: var(--box-bg); }
.step p { margin: 0 0 8px; }
.sub-title { margin: 16px 0 8px; font-size: 18px; }

.form { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; align-items: end; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--input-label, var(--muted)); }
.form label.check { flex-direction: row; align-items: center; gap: 8px; padding-bottom: 8px; }
.form input[type=number] { width: 100%; }
.form .ns { grid-column: 1 / -1; }
.form-foot { display: flex; align-items: center; gap: 16px; margin-top: 16px; }

.result :deep(.banner) { font-size: 16px; }
.routes { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 12px 0 0; }
.route { padding: 4px 12px; border: var(--border-width) solid var(--border); border-radius: 14px; font-size: 14px; }
.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin: 8px 0 16px; }
.evictions { margin-top: 8px; }
.fold { margin-top: 12px; }
.fold p, .fold ul { margin: 8px 0 0; }

.fold summary { cursor: pointer; }
.dry-run-actions { display: flex; align-items: center; gap: 12px; margin: 8px 0 12px; }
.dry-run-evictions { margin: 8px 0 0; }
.caveat { font-size: 14px; }
</style>
