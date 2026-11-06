/**
 * Cuts raw API answers down to the fields the checks use. No imports on purpose: the same code builds the unit-test
 * fixtures from a live cluster (node can import this file directly), so tests and page always see the same shape.
 * Never keeps secret data, cloud-init or chart values.
 */
const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const meta = (o, keep = {}) => ({
  name:      o?.metadata?.name,
  namespace: o?.metadata?.namespace,
  ...(keep.labels ? { labels: o?.metadata?.labels || {} } : {}),
  ...(keep.annotations ? { annotations: o?.metadata?.annotations || {} } : {}),
  ...(keep.created ? { creationTimestamp: o?.metadata?.creationTimestamp } : {})
});
const cond = (o, type) => (o?.status?.conditions || []).find((c) => c.type === type) || null;
const claimOf = (v) => v?.persistentVolumeClaim?.claimName || v?.dataVolume?.name || null;

const UNITS = {
  Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3
};

/** Kubernetes quantity ("16Gi", "7021Mi", "128974848", "1.5G", "1e3") -> bytes; null when absent or unparsable. */
export function parseBytes(q) {
  if (q === undefined || q === null || q === '') {
    return null;
  }
  const m = String(q).trim().match(/^([0-9.]+(?:[eE][-+]?[0-9]+)?)([a-zA-Z]{0,2})$/);

  if (!m || (m[2] && !UNITS[m[2]])) {
    return null;
  }

  return Number(m[1]) * (m[2] ? UNITS[m[2]] : 1);
}

/** Memory a pod requests the way the scheduler counts it: max(sum of containers, largest init container) + overhead. */
export function podMemoryRequest(pod) {
  const req = (c) => parseBytes(c?.resources?.requests?.memory) || 0;
  const containers = (pod?.spec?.containers || []).reduce((a, c) => a + req(c), 0);
  const init = Math.max(0, ...(pod?.spec?.initContainers || []).map(req));

  return Math.max(containers, init) + (parseBytes(pod?.spec?.overhead?.memory) || 0);
}

export const TRIM = {
  nodes: (r) => list(r).map((n) => ({
    // Only the machine annotation: node annotations also carry RKE2 command-line args.
    metadata: { ...meta(n, { labels: true }), annotations: { 'cluster.x-k8s.io/machine': n?.metadata?.annotations?.['cluster.x-k8s.io/machine'] } },
    spec:     { unschedulable: !!n?.spec?.unschedulable },
    status:   { ready: cond(n, 'Ready')?.status || 'Unknown', allocatableMemory: parseBytes(n?.status?.allocatable?.memory) }
  })),
  upgrades: (r) => list(r).map((u) => ({
    metadata: {
      ...meta(u, { labels: true, created: true }),
      annotations: Object.fromEntries(Object.entries(u?.metadata?.annotations || {}).filter(([k]) => k.startsWith('harvesterhci.io/')))
    },
    spec:     {
      version: u?.spec?.version || '', image: u?.spec?.image || '', logEnabled: !!u?.spec?.logEnabled
    },
    status:   {
      previousVersion: u?.status?.previousVersion || '',
      repoInfo:        u?.status?.repoInfo || '',
      conditions:      (u?.status?.conditions || []).map((c) => ({
        type: c.type, status: c.status, reason: c.reason || '', message: c.message || ''
      })),
      singleNode:      u?.status?.singleNode || '',
      nodeStatuses:    u?.status?.nodeStatuses || {}
    }
  })),
  versions:       (r) => list(r).map((v) => ({ metadata: meta(v) })),
  upgradeConfig:  (r) => ({ value: r?.value || '', default: r?.default || '' }),
  checkerEnabled: (r) => ({ value: r?.value || '', default: r?.default || '' }),
  serverVersion:  (r) => ({ value: r?.value || '', default: r?.default || '' }),
  managedCharts:  (r) => list(r).map((m) => ({
    metadata: meta(m),
    status:   {
      ready: cond(m, 'Ready') ? {
        status: cond(m, 'Ready').status, message: cond(m, 'Ready').message || '', lastUpdateTime: cond(m, 'Ready').lastUpdateTime || null
      } : null
    }
  })),
  bundleDeployments: (r) => list(r).map((b) => ({
    metadata: meta(b),
    status:   {
      modifiedStatus: b?.status?.modifiedStatus || [],
      nonReadyStatus: b?.status?.nonReadyStatus || [],
      conditions:     (b?.status?.conditions || []).map((c) => ({
        type: c.type, status: c.status, lastUpdateTime: c.lastUpdateTime || null, message: c.message || ''
      }))
    }
  })),
  capiCluster: (r) => ({ status: { phase: r?.status?.phase || '' } }),
  machines:    (r) => list(r).map((m) => ({
    metadata: meta(m, { labels: true }),
    status:   { phase: m?.status?.phase || '', nodeRef: m?.status?.nodeRef?.name || null }
  })),
  addons: (r) => list(r).map((a) => ({
    metadata: meta(a),
    spec:     { enabled: !!a?.spec?.enabled },
    status:   { status: a?.status?.status || '' }
  })),
  vmBackups: (r) => list(r).map((b) => ({
    metadata: meta(b),
    status:   { error: b?.status?.error ? { message: b.status.error.message || '' } : null, readyToUse: b?.status?.readyToUse ?? null }
  })),
  schedules: (r) => list(r).map((s) => ({
    metadata: meta(s),
    spec:     { suspend: !!s?.spec?.suspend },
    status:   { suspended: !!s?.status?.suspended }
  })),
  lhVolumes: (r) => list(r).map((v) => ({
    metadata: meta(v),
    spec:     { numberOfReplicas: v?.spec?.numberOfReplicas, size: v?.spec?.size },
    status:   {
      state:            v?.status?.state || '',
      robustness:       v?.status?.robustness || '',
      kubernetesStatus: { namespace: v?.status?.kubernetesStatus?.namespace || '', pvcName: v?.status?.kubernetesStatus?.pvcName || '' }
    }
  })),
  lhReplicas: (r) => list(r).map((x) => ({
    metadata: meta(x),
    spec:     {
      volumeName: x?.spec?.volumeName, nodeID: x?.spec?.nodeID, healthyAt: x?.spec?.healthyAt || '', failedAt: x?.spec?.failedAt || '', rebuildRetryCount: x?.spec?.rebuildRetryCount || 0
    }
  })),
  vmis: (r) => list(r).map((i) => ({
    metadata: meta(i),
    spec:     {
      nodeSelector: i?.spec?.nodeSelector || null,
      affinity:     i?.spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution ? { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: i.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution } } : null,
      hostDevices:  i?.spec?.domain?.devices?.hostDevices ? i.spec.domain.devices.hostDevices.map((d) => d.deviceName) : null,
      volumes:      (i?.spec?.volumes || []).map((v) => ({
        name: v.name, claim: claimOf(v), hotpluggable: !!(v?.persistentVolumeClaim?.hotpluggable || v?.dataVolume?.hotpluggable)
      }))
    },
    status: { nodeName: i?.status?.nodeName || '', phase: i?.status?.phase || '' }
  })),
  // Plan secrets hold join tokens: only their labels are kept (and the page asks the API for metadata only).
  planSecrets: (r) => list(r).map((x) => ({ metadata: { name: x?.metadata?.name, labels: x?.metadata?.labels || {} } })),
  pods:        (r) => list(r).filter((p) => !['Succeeded', 'Failed'].includes(p?.status?.phase) && p?.spec?.nodeName).map((p) => ({
    namespace: p.metadata.namespace,
    node:      p.spec.nodeName,
    memory:    podMemoryRequest(p),
    vm:        p.metadata.labels?.['kubevirt.io'] === 'virt-launcher' ? p.metadata.labels?.['vm.kubevirt.io/name'] || null : null
  })),
  // Only Harvester release ISOs (upgrade sources); other images are not needed.
  images: (r) => list(r).filter((i) => /^harvester-v.*\.iso$/i.test(i?.spec?.displayName || '')).map((i) => ({
    metadata: meta(i), spec: { displayName: i.spec.displayName }, status: { progress: i?.status?.progress ?? null }
  })),
  etcdPods: (r) => list(r).map((p) => ({
    node:     p?.spec?.nodeName || '',
    ready:    (p?.status?.conditions || []).find((c) => c.type === 'Ready')?.status === 'True',
    restarts: (p?.status?.containerStatuses || []).reduce((a, c) => a + (c.restartCount || 0), 0),
    phase:    p?.status?.phase || ''
  })),
  vmims: (r) => list(r).map((m) => ({
    metadata: meta(m, { created: true, annotations: true }),
    vmi:      m?.spec?.vmiName || '',
    phase:    m?.status?.phase || '',
    source:   m?.status?.migrationState?.sourceNode || '',
    target:   m?.status?.migrationState?.targetNode || '',
    reason:   m?.status?.migrationState?.failureReason || (m?.status?.conditions || []).map((c) => c.message || c.reason).filter(Boolean).join('; ') || ''
  })),
  k3sAddons: (r) => list(r).map((a) => ({ metadata: meta(a), spec: { source: a?.spec?.source || '' } })),
  vms:       (r) => list(r).map((v) => ({
    metadata: meta(v),
    spec:     { volumes: (v?.spec?.template?.spec?.volumes || []).map((x) => ({ name: x.name, claim: claimOf(x) })) },
    status:   { printableStatus: v?.status?.printableStatus || '', volumeRequests: (v?.status?.volumeRequests || []).length }
  }))
};

/** kubelet stats/summary + configz -> the three numbers the disk check needs. */
export function trimKubelet(summary, configz) {
  const fs = summary?.node?.fs || {};

  return {
    usedBytes:     fs.usedBytes ?? null,
    capacityBytes: fs.capacityBytes ?? null,
    gcHigh:        configz?.kubeletconfig?.imageGCHighThresholdPercent ?? null
  };
}
