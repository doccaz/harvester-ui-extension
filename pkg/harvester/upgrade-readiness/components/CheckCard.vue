<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { RcSection, RcSectionBadges } from '@components/RcSection';
import CopyToClipboard from '@shell/components/CopyToClipboard';
import ChartDrift from './ChartDrift.vue';
import { useTranslation } from '../utils/i18n';
import { HARVESTER_PRODUCT } from '../config/names';

// One pre-flight finding. Collapsed: title, count, status. Open: the objects, what to do, fixes; the "why" sits behind
// a native <details> so the page stays short. Read-only: buttons only navigate or copy a command.
const props = defineProps({ check: { type: Object, required: true } });
const t = useTranslation();
const route = useRoute();
const MAX = 8;
const showAll = ref(false);
const expanded = ref(props.check.status === 'block');
const k = (part) => `harvester.upgradeReadiness.check.${ props.check.id }.${ part }`;
// Failing checks are titled by the problem ("VMs that cannot live-migrate"), others by the requirement.
const title = computed(() => t(k(['block', 'warn'].includes(props.check.status) ? 'problem' : 'title')));
const items = computed(() => (showAll.value ? props.check.items : props.check.items.slice(0, MAX)));
const STATUS = {
  block: 'error', warn: 'warning', unknown: 'unknown', skip: 'info', pass: 'success'
};
const badges = computed(() => [{ label: t(`harvester.upgradeReadiness.status.${ props.check.status }`), status: STATUS[props.check.status] }]);

/** Router location of a Harvester resource list or detail page. */
function to(target) {
  const params = {
    product: HARVESTER_PRODUCT, cluster: route.params.cluster || 'local', resource: target.resource
  };

  if (target.id && target.namespace) {
    return {
      name:   `${ HARVESTER_PRODUCT }-c-cluster-resource-namespace-id`,
      params: {
        ...params, namespace: target.namespace, id: target.id
      }
    };
  }
  if (target.id) {
    return {
      name: `${ HARVESTER_PRODUCT }-c-cluster-resource-id`, params: { ...params, id: target.id }, query: target.query || {}
    };
  }

  return { name: `${ HARVESTER_PRODUCT }-c-cluster-resource`, params };
}

const showStuck = (item) => !!item.stuckReplicas?.length && !!item.volume;
const deleteReplica = (sr) => `kubectl -n longhorn-system delete replicas.longhorn.io ${ sr.name }`;

/** Longhorn UI page of a volume, through the cluster's service proxy (same link the Harvester volume page uses). */
function longhornVolume(volume) {
  return `${ window.location.origin }/k8s/clusters/${ route.params.cluster || 'local' }/api/v1/namespaces/longhorn-system/services/http:longhorn-frontend:80/proxy/#/volume/${ volume }`;
}

function details(item) {
  const parts = [];

  if (item.reason) {
    parts.push(t(`harvester.upgradeReadiness.check.${ props.check.id }.reason.${ item.reason }`, item.reasonArgs));
  }
  if (item.note) {
    parts.push(item.note);
  }
  if (item.replicaNodes?.length) {
    parts.push(t('harvester.upgradeReadiness.replica.on', { nodes: item.replicaNodes.join(', ') }));
  }
  if (item.unusedReplicaNodes?.length) {
    parts.push(t('harvester.upgradeReadiness.replica.unused', { nodes: item.unusedReplicaNodes.join(', ') }));
  }

  return parts.join(' · ');
}
</script>

<template>
  <RcSection
    v-model:expanded="expanded"
    class="check"
    type="secondary"
    mode="with-header"
    :expandable="true"
  >
    <template #title>
      <h2 class="check-title">
        {{ title }}
      </h2>
    </template>
    <template
      v-if="check.items.length"
      #counter
    >
      {{ check.items.length }}
    </template>
    <template #badges>
      <RcSectionBadges :badges="badges" />
    </template>

    <div class="body">
      <p v-if="check.status === 'unknown'">
        {{ t('harvester.upgradeReadiness.unknown', check.args) }}
      </p>
      <p v-else-if="check.status === 'skip'">
        {{ t(k('skip'), check.args) }}
      </p>
      <template v-else>
        <template v-if="check.items.some((it) => it.chart)">
          <ChartDrift
            v-for="it in check.items"
            :key="it.text"
            :name="it.text"
            :chart="it.chart || { rows: [], errors: [], fresh: { known: false } }"
          />
        </template>
        <table
          v-else-if="check.items.length"
          class="items"
        >
          <caption class="sr-only">
            {{ title }}
          </caption>
          <tbody>
            <template
              v-for="(item, i) in items"
              :key="i"
            >
              <tr>
                <th scope="row">
                  <router-link
                    v-if="item.link"
                    :to="to(item.link)"
                  >
                    {{ item.text }}
                  </router-link>
                  <span v-else>{{ item.text }}</span>
                </th>
                <td
                  v-if="item.disk !== undefined"
                  class="disk"
                  :title="item.disk"
                >
                  {{ item.disk }}
                </td>
                <td>{{ details(item) }}</td>
                <td class="tags">
                  <span
                    v-if="item.attached === false"
                    class="tag"
                  >{{ t('harvester.upgradeReadiness.replica.detached') }}</span>
                  <span
                    v-if="item.stuckReplicaNodes?.length"
                    class="tag warning"
                  >{{ t('harvester.upgradeReadiness.replica.stuck', { nodes: item.stuckReplicaNodes.join(', ') }) }}</span>
                </td>
              </tr>
              <tr
                v-for="sr in (showStuck(item) ? item.stuckReplicas : [])"
                :key="`${ i }-${ sr.name }`"
                class="hint-row"
              >
                <td :colspan="item.disk !== undefined ? 4 : 3">
                  <p class="hint">
                    {{ t('harvester.upgradeReadiness.replica.stuckHint', { node: sr.node, retries: sr.retries }) }}
                  </p>
                  <div class="fixes">
                    <a
                      class="btn btn-sm role-secondary"
                      :href="longhornVolume(item.volume)"
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{ t('harvester.upgradeReadiness.replica.openLonghorn') }}</a>
                    <div class="copy">
                      <code>{{ deleteReplica(sr) }}</code>
                      <CopyToClipboard
                        :text="deleteReplica(sr)"
                        class="btn-sm"
                      />
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <button
          v-if="check.items.length > MAX"
          type="button"
          class="btn btn-sm role-link more"
          @click="showAll = !showAll"
        >
          {{ showAll ? t('harvester.upgradeReadiness.showLess') : t('harvester.upgradeReadiness.showMore', { n: check.items.length - MAX }) }}
        </button>

        <p
          v-if="check.status === 'pass'"
          class="text-muted"
        >
          {{ t(k('ok'), check.args) }}
        </p>
        <p
          v-else
          class="do"
        >
          {{ t(k('do'), check.args) }}
        </p>

        <div
          v-if="check.fixes.length && check.status !== 'pass'"
          class="fixes"
        >
          <template
            v-for="(f, i) in check.fixes"
            :key="i"
          >
            <router-link
              v-if="f.kind === 'goto'"
              class="btn btn-sm role-secondary"
              :to="to(f.to)"
            >
              {{ t(`harvester.upgradeReadiness.fix.${ f.labelKey }`) }}
            </router-link>
            <div
              v-else-if="f.kind === 'copy'"
              class="copy"
            >
              <span>{{ t(`harvester.upgradeReadiness.fix.${ f.labelKey }`) }}</span>
              <code>{{ f.command }}</code>
              <CopyToClipboard
                :text="f.command"
                class="btn-sm"
              />
            </div>
            <p
              v-else-if="f.kind === 'option'"
              class="option"
            >
              {{ t(`harvester.upgradeReadiness.fix.${ f.labelKey }`) }}
            </p>
          </template>
        </div>

        <details
          v-if="check.status !== 'pass'"
          class="why"
        >
          <summary>{{ t('harvester.upgradeReadiness.why') }}</summary>
          <p>{{ t(k('why'), check.args) }}</p>
        </details>
      </template>
    </div>
  </RcSection>
</template>

<style lang="scss" scoped>
.check { margin-bottom: 12px; }
.check-title { font-size: 16px; margin: 0; font-weight: 600; }
.body { font-size: 14px; p { margin: 8px 0; } }
.items {
  border-collapse: collapse; margin: 4px 0 8px; width: 100%;
  th, td { padding: 4px 12px 4px 0; text-align: left; vertical-align: top; font-weight: normal; }
  th { white-space: nowrap; }
  .disk { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--input-label); }
  .tags { white-space: nowrap; }
  .hint-row td { padding: 0 0 10px 16px; border-left: 3px solid var(--warning); }
  .hint { margin: 2px 0 6px; }
}
.tag {
  display: inline-block; margin-right: 6px; padding: 0 8px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px;
  &.warning { border-color: var(--warning); }
}
.do { font-weight: 600; }
.fixes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.copy { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; code { padding: 2px 6px; } }
.option { margin: 4px 0; padding: 6px 10px; border-left: 3px solid var(--info); width: 100%; }
.why { margin-top: 8px; summary { cursor: pointer; color: var(--link); } p { margin: 6px 0 0; } }
.more { padding-left: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
