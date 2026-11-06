/**
 * Phase 0: can the browser, with the user's own session, read everything the upgrade pages need?
 * Every probe is a GET. Paths use the standalone form; `clusterRequest` maps them when embedded in Rancher.
 * Each probe returns a short summary; secrets are never shown (only whether the field is present).
 */
const K8S = '/k8s/clusters/local';

const items = (r) => r?.items || r?.data || [];
const count = (r) => `${ items(r).length } item(s)`;

// Ask the API server for metadata only: plan secrets hold join tokens we neither need nor want in the browser.
export const METADATA_ONLY = { Accept: 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1,application/json' };

/** Static probes: one GET each. `need` says which feature depends on it. */
export const PROBES = [
  {
    id: 'upgrades', need: 'history, live view', url: `${ K8S }/apis/harvesterhci.io/v1beta1/namespaces/harvester-system/upgrades`, summary: count
  },
  {
    id: 'versions', need: 'pre-flight (target)', url: `${ K8S }/apis/harvesterhci.io/v1beta1/namespaces/harvester-system/versions`, summary: count
  },
  {
    id: 'upgradeConfig', need: 'plan preview', url: `${ K8S }/apis/harvesterhci.io/v1beta1/settings/upgrade-config`, summary: (r) => `value ${ r?.value ? 'set' : 'default' }`
  },
  {
    id: 'managedCharts', need: 'pre-flight, drift', url: `${ K8S }/apis/management.cattle.io/v3/namespaces/fleet-local/managedcharts`, summary: count
  },
  {
    id: 'bundleDeployments', need: 'drift explainer', url: `${ K8S }/apis/fleet.cattle.io/v1alpha1/bundledeployments`, summary: (r) => `${ items(r).length } item(s), ${ items(r).filter((b) => b?.status?.modifiedStatus?.length).length } with drift`
  },
  {
    id: 'k3sAddons', need: 'drift owner (RKE2 manifest file)', url: `${ K8S }/apis/k3s.cattle.io/v1/namespaces/kube-system/addons`, summary: count
  },
  {
    id: 'capiCluster', need: 'pre-flight', url: `${ K8S }/apis/cluster.x-k8s.io/v1beta2/namespaces/fleet-local/clusters/local`, summary: (r) => `phase ${ r?.status?.phase }`
  },
  {
    id: 'capiMachines', need: 'pre-flight, node order', url: `${ K8S }/apis/cluster.x-k8s.io/v1beta2/namespaces/fleet-local/machines`, summary: count
  },
  {
    id:      'planSecretsMeta',
    need:    'node order (init node)',
    url:     `${ K8S }/api/v1/namespaces/fleet-local/secrets?labelSelector=${ encodeURIComponent('rke.cattle.io/machine-name') }`,
    headers: METADATA_ONLY,
    summary: (r) => {
      const list = items(r);
      const leaked = list.some((s) => s?.data);
      const init = list.find((s) => s?.metadata?.labels?.['rke.cattle.io/init-node'] === 'true');

      return `${ list.length } item(s), kind ${ r?.kind }, data ${ leaked ? 'PRESENT (metadata-only not honoured)' : 'absent' }, init ${ init?.metadata?.labels?.['rke.cattle.io/machine-name'] || '?' }`;
    }
  },
  {
    id:      'servingCert',
    need:    'pre-flight (cert expiry, approximate)',
    url:     `${ K8S }/api/v1/namespaces/kube-system/secrets/rke2-serving`,
    summary: (r) => `tls.crt ${ r?.data?.['tls.crt'] ? 'present' : 'missing' }`
  },
  {
    id: 'harvesterAddons', need: 'pre-flight', url: `${ K8S }/apis/harvesterhci.io/v1beta1/addons`, summary: count
  },
  {
    id: 'vmBackups', need: 'pre-flight', url: `${ K8S }/apis/harvesterhci.io/v1beta1/virtualmachinebackups`, summary: count
  },
  {
    id: 'scheduleBackups', need: 'pre-flight', url: `${ K8S }/apis/harvesterhci.io/v1beta1/schedulevmbackups`, summary: count
  },
  {
    id: 'lhVolumes', need: 'pre-flight (degraded, single replica)', url: `${ K8S }/apis/longhorn.io/v1beta2/namespaces/longhorn-system/volumes`, summary: count
  },
  {
    id: 'lhReplicas', need: 'advice (replica placement)', url: `${ K8S }/apis/longhorn.io/v1beta2/namespaces/longhorn-system/replicas`, summary: count
  },
  {
    id: 'lhNodes', need: 'advice (space for a 2nd replica)', url: `${ K8S }/apis/longhorn.io/v1beta2/namespaces/longhorn-system/nodes`, summary: count
  },
  {
    id: 'vmis', need: 'pre-flight (migratable)', url: `${ K8S }/apis/kubevirt.io/v1/virtualmachineinstances`, summary: count
  },
  {
    id: 'vms', need: 'pre-flight (hotplug), volume -> VM', url: `${ K8S }/apis/kubevirt.io/v1/virtualmachines`, summary: count
  },
  {
    id: 'apiEndpoints', need: 'pre-flight (cert)', url: `${ K8S }/api/v1/namespaces/default/endpoints/kubernetes`, summary: (r) => `${ (r?.subsets || []).flatMap((s) => s.addresses || []).length } address(es)`
  }
];

/** Probes that depend on a first answer (per node, per pod). */
export function nodeProbes(nodeNames) {
  return nodeNames.flatMap((n) => [
    {
      id:      `stats:${ n }`,
      need:    'pre-flight (disk space)',
      url:     `${ K8S }/api/v1/nodes/${ n }/proxy/stats/summary`,
      summary: (r) => {
        const fs = r?.node?.fs;

        return fs ? `fs ${ Math.round(fs.usedBytes / fs.capacityBytes * 100) }% used` : 'no fs stats';
      }
    },
    {
      id:      `configz:${ n }`,
      need:    'pre-flight (image GC threshold)',
      url:     `${ K8S }/api/v1/nodes/${ n }/proxy/configz`,
      summary: (r) => `imageGCHighThresholdPercent ${ r?.kubeletconfig?.imageGCHighThresholdPercent ?? 'default' }`
    }
  ]);
}

export function fleetAgentLogProbe(podName) {
  return {
    id:      'fleetAgentLog',
    need:    'drift freshness (last/next retry)',
    url:     `${ K8S }/api/v1/namespaces/cattle-fleet-local-system/pods/${ podName }/log?tailLines=200`,
    summary: (r) => {
      const text = typeof r === 'string' ? r : (r?.data || '');

      return `${ text.split('\n').filter(Boolean).length } line(s), mcc-harvester mentioned ${ text.includes('mcc-harvester') ? 'yes' : 'no' }`;
    }
  };
}

export const NODES_URL = `${ K8S }/api/v1/nodes`;
export const FLEET_AGENT_PODS_URL = `${ K8S }/api/v1/namespaces/cattle-fleet-local-system/pods`;

/** Runs one probe; never throws. */
export async function runProbe(request, probe) {
  const started = Date.now();

  try {
    const r = await request({ url: probe.url, headers: probe.headers });

    return {
      ...probe, ok: true, detail: probe.summary(r), ms: Date.now() - started
    };
  } catch (e) {
    const status = e?._status || e?.status || e?.response?.status;

    return {
      ...probe, ok: false, detail: `${ status || '' } ${ e?.message || e?._statusText || String(e) }`.trim(), ms: Date.now() - started
    };
  }
}
