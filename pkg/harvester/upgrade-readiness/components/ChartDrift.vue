<script setup>
import { computed } from 'vue';
import CopyToClipboard from '@shell/components/CopyToClipboard';
import { useTranslation } from '../utils/i18n';

// Why one ManagedChart is not ready, from Fleet's own records. Read-only: fixes are commands the user copies.
const props = defineProps({
  name:  { type: String, required: true },
  chart: { type: Object, required: true }
});
const t = useTranslation();
const k = (key, args) => t(`harvester.upgradeReadiness.drift.${ key }`, args);
const ORDER = {
  notOwned: 0, missing: 1, extra: 2, patch: 3, notReady: 4
};
const problems = computed(() => props.chart.rows.filter((r) => !(r.type === 'notReady' && r.stale)).sort((a, b) => ORDER[a.type] - ORDER[b.type]));
const stale = computed(() => props.chart.rows.filter((r) => r.type === 'notReady' && r.stale));
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const fmt = (v) => (v === undefined ? '—' : JSON.stringify(v));
const objName = (o) => `${ o.kind } ${ o.namespace ? `${ o.namespace }/` : '' }${ o.name }`;

function ownerText(row) {
  const o = row.owner || {};

  switch (o.type) {
  case 'rke2Manifest': return k('owner.rke2Manifest', { file: o.file || '?', addon: `${ o.addonNamespace }/${ o.addon }` });
  case 'helm': return k('owner.helm', { release: `${ o.releaseNamespace }/${ o.release }` });
  case 'fleet': return k('owner.fleet');
  case 'objectset': return k('owner.objectset', { owner: `${ o.gvk } ${ o.name }` });
  default: return k('owner.unknown');
  }
}

const freshText = computed(() => {
  const f = props.chart.fresh;

  if (!f?.known) {
    return k('fresh.unknown');
  }

  return k(`fresh.${ f.overdue ? 'overdue' : 'known' }`, {
    last: time(f.lastTry), outcome: k(`outcome.${ f.outcome }`), next: f.nextTry ? time(f.nextTry) : '?'
  });
});
</script>

<template>
  <div class="chart">
    <h3 class="chart-name">
      {{ name }}
    </h3>
    <p class="fresh text-muted">
      {{ freshText }}
    </p>

    <ul class="drift-rows">
      <li
        v-for="(r, i) in problems"
        :key="i"
        class="drift-row"
      >
        <div class="drift-head">
          <code>{{ objName(r.object) }}</code>
          <span
            class="tag"
            :class="r.type"
          >{{ k(`type.${ r.type }`) }}</span>
        </div>

        <p v-if="r.type === 'notOwned'">
          {{ ownerText(r) }}
        </p>
        <p v-else-if="r.type === 'missing' || r.type === 'extra'">
          {{ k(`explain.${ r.type }`) }}
        </p>
        <p v-else-if="r.type === 'notReady'">
          {{ r.state }}<span v-if="r.message">: {{ r.message }}</span>
        </p>
        <p
          v-if="r.error"
          class="fleet-error"
        >
          {{ k('fleetSays') }} <q>{{ r.error.text }}</q>
          <span v-if="r.error.immutable"> {{ k('explain.immutable') }}</span>
        </p>

        <table
          v-if="r.type === 'patch'"
          class="fields"
        >
          <thead>
            <tr>
              <th scope="col">
                {{ k('col.field') }}
              </th>
              <th scope="col">
                {{ k('col.want') }}
              </th>
              <th scope="col">
                {{ k('col.have') }}
              </th>
              <th scope="col">
                {{ k('col.by') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in r.fields"
              :key="f.path"
            >
              <td><code>{{ f.path }}</code></td>
              <td><code>{{ fmt(f.want) }}</code></td>
              <td><code>{{ fmt(f.have) }}</code></td>
              <td>{{ f.managers.length ? `${ f.managers[0].manager } ${ time(f.managers[0].time) }` : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p
          v-if="r.maybePending"
          class="text-muted"
        >
          {{ k('explain.maybePending') }}
        </p>

        <details
          v-if="r.commands.length"
          class="steps"
          :open="r.type === 'notOwned' || !!r.error"
        >
          <summary>{{ k('howToFix') }}</summary>
          <ol>
            <li
              v-for="c in r.commands"
              :key="c.step"
            >
              <span>{{ k(`step.${ c.step }`) }}</span>
              <span
                v-if="c.step === 'deleteObject'"
                class="risk"
              > {{ k(r.object.name === 'kube-vip' ? 'risk.kubeVip' : 'risk.deleteObject') }}</span>
              <div class="copy">
                <code>{{ c.command }}</code>
                <CopyToClipboard
                  :text="c.command"
                  class="btn-sm"
                />
              </div>
            </li>
          </ol>
        </details>
      </li>
    </ul>

    <p
      v-if="stale.length"
      class="text-muted"
    >
      {{ k('stale', { n: stale.length, names: stale.map((r) => r.object.name).join(', ') }) }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
.chart { margin: 4px 0 12px; font-size: 14px; }
.chart-name { font-size: 15px; margin: 0; font-weight: 600; }
.fresh { margin: 2px 0 8px; }
.drift-rows { list-style: none; padding: 0; margin: 0; }
.drift-row { padding: 8px 0 8px 12px; border-left: 3px solid var(--border); margin-bottom: 8px; p { margin: 4px 0; } }
.drift-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tag {
  padding: 0 8px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px;
  &.notOwned, &.missing { border-color: var(--error); }
  &.patch, &.extra, &.notReady { border-color: var(--warning); }
}
.fleet-error q { font-family: monospace; }
.fields { border-collapse: collapse; margin: 6px 0; th, td { padding: 2px 12px 2px 0; text-align: left; vertical-align: top; } th { font-weight: 600; } }
.steps { margin-top: 6px; summary { cursor: pointer; color: var(--link); } ol { margin: 6px 0 0; padding-left: 20px; } li { margin: 6px 0; } }
.risk { color: var(--warning); }
.copy { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; code { padding: 2px 6px; } }
</style>
