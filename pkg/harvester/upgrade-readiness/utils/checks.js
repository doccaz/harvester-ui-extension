/**
 * Pre-flight checks: the rules of Harvester's Upgrade admission webhook (harvester v1.8.2,
 * pkg/webhook/resources/upgrade/validator.go, Create), run ALL at once on a trimmed snapshot (see trim.js).
 * The webhook stops at the first failure; this lists every one, maps objects to VMs/nodes and suggests fixes.
 *
 * Result: { id, status, items, fixes, args, missing }
 *   status: 'pass' | 'block' | 'warn' | 'skip' (the webhook skips it here) | 'unknown' (could not read the data)
 *   items:  [{ text, link?, note? }]  objects the finding is about
 *   fixes:  [{ kind: 'goto' | 'copy' | 'option', labelKey, to?, command? }]
 */
import { explainChart, fixCommands, fleetAttempts, freshness } from './drift';
import { moveLoad } from './plan';
import { WITNESS_LABEL } from './constants';

export { WITNESS_LABEL };
export const NEW_IMAGES_BYTES = 13 * 1024 ** 3; // defaultNewImageSize
export const GC_DEFAULT = 85; // defaultImageGCHighThresholdPercent
export const CERT_MIN_DAYS = 7; // defaultMinCertsExpirationInDay
const DAY = 24 * 3600 * 1000;

// Harvester UI resource types used for "Go to" links.
export const TYPES = {
  VM: 'kubevirt.io.virtualmachine', VOLUME: 'harvesterhci.io.volume', SCHEDULE: 'harvesterhci.io.schedulevmbackup', BACKUP: 'harvesterhci.io.vmbackup', HOST: 'harvesterhci.io.host', ADDON: 'harvesterhci.io.addon', SETTING: 'harvesterhci.io.setting', DASHBOARD: 'harvesterhci.io.dashboard'
};

const nsName = (o) => (o?.metadata?.namespace ? `${ o.metadata.namespace }/${ o.metadata.name }` : o?.metadata?.name);
const link = (resource, o) => ({
  resource, namespace: o?.metadata?.namespace, id: o?.metadata?.name
});
const goto = (labelKey, to) => ({
  kind: 'goto', labelKey, to
});

function result(id, status, extra = {}) {
  return {
    id, status, items: [], fixes: [], args: {}, ...extra
  };
}

/** Runs `fn` unless one of the sources it needs failed to load. */
function guarded(id, s, sources, fn) {
  const missing = sources.filter((k) => s.errors?.[k] || s[k] === undefined);

  if (missing.length) {
    return result(id, 'unknown', { missing, args: { sources: missing.join(', ') } });
  }

  return fn();
}

export const nonWitness = (nodes) => nodes.filter((n) => !(WITNESS_LABEL in (n.metadata.labels || {})));

/** PVC namespace/name -> VM (from the VM templates). */
export function pvcToVm(vms) {
  const map = {};

  (vms || []).forEach((vm) => (vm.spec.volumes || []).forEach((v) => {
    if (v.claim) {
      map[`${ vm.metadata.namespace }/${ v.claim }`] = vm;
    }
  }));

  return map;
}

/** Selector-term match (In/NotIn/Exists/DoesNotExist, metadata.name fields), as used by the webhook's affinity rule. */
export function matchesTerms(node, required) {
  const labels = node.metadata.labels || {};

  return (required?.nodeSelectorTerms || []).some((t) => (t.matchExpressions || []).every((e) => {
    const v = labels[e.key];

    switch (e.operator) {
    case 'In': return (e.values || []).includes(v);
    case 'NotIn': return !(e.values || []).includes(v);
    case 'Exists': return e.key in labels;
    case 'DoesNotExist': return !(e.key in labels);
    default: return false;
    }
  }) && (t.matchFields || []).every((f) => f.key === 'metadata.name' && ((f.values || []).includes(node.metadata.name) === (f.operator === 'In'))));
}

const CHECKS = {
  upgradeRunning: (s) => guarded('upgradeRunning', s, ['upgrades'], () => {
    const running = s.upgrades.filter((u) => !['Succeeded', 'Failed'].includes(u.metadata.labels?.['harvesterhci.io/upgradeState']));

    return result('upgradeRunning', running.length ? 'block' : 'pass', { items: running.map((u) => ({ text: u.metadata.name })) });
  }),

  cleanupPending: (s) => guarded('cleanupPending', s, ['upgrades'], () => {
    const pending = s.upgrades.filter((u) => u.metadata.labels?.['harvesterhci.io/upgradeCleanup'] === 'pending');

    return result('cleanupPending', pending.length ? 'block' : 'pass', { items: pending.map((u) => ({ text: u.metadata.name })) });
  }),

  versionAvailable: (s) => guarded('versionAvailable', s, ['versions'], () => {
    const setting = (x) => (x ? (x.value || x.default) : '');
    const current = setting(s.serverVersion) || '';
    const checker = s.checkerEnabled ? setting(s.checkerEnabled) !== 'false' : null;
    // An uploaded Harvester ISO newer than the running version is an upgrade source too (the "upgrade from image" page).
    const isos = (s.images || []).map((i) => ({ image: i, version: isoVersion(i.spec.displayName) }))
      .filter((x) => x.version && compareVersions(x.version, current) > 0 && (x.image.status.progress === null || x.image.status.progress >= 100))
      .sort((a, b) => compareVersions(b.version, a.version));
    const ready = s.versions.length > 0 || isos.length > 0;

    return result('versionAvailable', ready ? 'pass' : 'warn', {
      items: s.versions.map((v) => ({ text: v.metadata.name })),
      args:  {
        count: s.versions.length, current: current || '?', checker: checker === null ? 'unknown' : (checker ? 'on' : 'off'), iso: isos.map((x) => x.image.spec.displayName).join(', ')
      },
      okKey: !s.versions.length && isos.length ? 'okIso' : 'ok',
      fixes: ready ? [] : [
        // Each setting's own edit form (the Settings list has no anchors); the user still has to press Save.
        goto('goCheckerEnabled', {
          resource: TYPES.SETTING, id: 'upgrade-checker-enabled', query: { mode: 'edit' }
        }),
        goto('goCheckerUrl', {
          resource: TYPES.SETTING, id: 'upgrade-checker-url', query: { mode: 'edit' }
        }),
        goto('goDashboard', { resource: TYPES.DASHBOARD })
      ],
      // Shown even when passing: the way to start an upgrade from the uploaded ISO.
      extraFixes: isos.length ? [{
        kind: 'goto', labelKey: 'goAirgapUpgrade', to: { routeName: 'airgapupgrade' }
      }] : []
    });
  }),

  longhornDegraded: (s) => guarded('longhornDegraded', s, ['nodes', 'lhVolumes', 'vms'], () => {
    if (s.nodes.length < 3) {
      return result('longhornDegraded', 'skip');
    }
    const vmOf = pvcToVm(s.vms);
    const bad = s.lhVolumes.filter((v) => v.status.robustness === 'degraded');

    return result('longhornDegraded', bad.length ? 'block' : 'pass', {
      items: bad.map((v) => volumeItem(v, vmOf)),
      fixes: bad.length ? [goto('goVolumes', { resource: TYPES.VOLUME })] : []
    });
  }),

  clusterProvisioned: (s) => guarded('clusterProvisioned', s, ['capiCluster'], () => result('clusterProvisioned', s.capiCluster.status.phase === 'Provisioned' ? 'pass' : 'block', { args: { phase: s.capiCluster.status.phase || '?' } })),

  vmBackupsRunning: (s) => guarded('vmBackupsRunning', s, ['vmBackups'], () => {
    const busy = s.vmBackups.filter((b) => !b.status.error && !b.status.readyToUse);

    return result('vmBackupsRunning', busy.length ? 'block' : 'pass', { items: busy.map((b) => ({ text: nsName(b), link: link(TYPES.BACKUP, b) })) });
  }),

  schedulesActive: (s) => guarded('schedulesActive', s, ['schedules'], () => {
    const active = s.schedules.filter((x) => !x.status.suspended);

    return result('schedulesActive', active.length ? 'block' : 'pass', {
      items: active.map((x) => ({ text: nsName(x), link: link(TYPES.SCHEDULE, x) })),
      fixes: active.length ? [goto('goSchedules', { resource: TYPES.SCHEDULE })] : [],
      args:  { count: active.length }
    });
  }),

  managedCharts: (s) => guarded('managedCharts', s, ['managedCharts'], () => {
    const bad = s.managedCharts.filter((m) => m.status.ready && m.status.ready.status !== 'True');

    return result('managedCharts', bad.length ? 'block' : 'pass', {
      items: bad.map((m) => {
        const bdName = `mcc-${ m.metadata.name }`;
        const bd = (s.bundleDeployments || []).find((b) => b.metadata.name === bdName);
        const explained = bd && s.drift ? explainChart(bd, s.drift.live, s.drift.k3sAddons) : null;

        return {
          text:  m.metadata.name,
          note:  m.status.ready.message,
          chart: explained ? {
            ...explained,
            rows:  explained.rows.map((r) => ({ ...r, commands: fixCommands(r) })),
            fresh: freshness(fleetAttempts(s.drift.fleetLog, bdName), s.now ?? Date.now())
          } : null
        };
      }),
      // With the explainer, each row carries its own steps (including "retry now"); without it, offer the retry here.
      fixes: bad.length && !s.drift ? [{
        kind: 'copy', labelKey: 'copyFleetRetry', command: 'kubectl -n cattle-fleet-local-system rollout restart deploy/fleet-agent'
      }] : []
    });
  }),

  addonsSettled: (s) => guarded('addonsSettled', s, ['addons'], () => {
    const bad = s.addons.filter((a) => (a.spec.enabled ? a.status.status !== 'AddonDeploySuccessful' : !['AddonDisabled', ''].includes(a.status.status)));

    return result('addonsSettled', bad.length ? 'block' : 'pass', {
      items: bad.map((a) => ({
        text: nsName(a), note: `${ a.spec.enabled ? 'enabled' : 'disabled' }, ${ a.status.status || '-' }`, link: link(TYPES.ADDON, a)
      }))
    });
  }),

  nodesReady: (s) => guarded('nodesReady', s, ['nodes'], () => {
    const items = [];

    s.nodes.forEach((n) => {
      if (n.status.ready !== 'True') {
        items.push({
          text: n.metadata.name, note: 'not Ready', link: { resource: TYPES.HOST, id: n.metadata.name }
        });
      }
      if (n.spec.unschedulable) {
        items.push({
          text: n.metadata.name, note: 'cordoned / maintenance mode', link: { resource: TYPES.HOST, id: n.metadata.name }
        });
      }
    });

    return result('nodesReady', items.length ? 'block' : 'pass', { items, fixes: items.length ? [goto('goHosts', { resource: TYPES.HOST })] : [] });
  }),

  diskSpace: (s) => guarded('diskSpace', s, ['nodes', 'kubelet'], () => {
    const items = [];
    let unknown = false;

    s.nodes.forEach((n) => {
      const k = s.kubelet[n.metadata.name];

      if (!k || k.usedBytes === null || k.usedBytes === undefined || !k.capacityBytes) {
        unknown = true;
        items.push({ text: n.metadata.name, note: 'no kubelet stats' });

        return;
      }
      const gc = k.gcHigh ?? GC_DEFAULT;
      const pct = (k.usedBytes + NEW_IMAGES_BYTES) / k.capacityBytes * 100;

      items.push({
        text: n.metadata.name, note: `${ pct.toFixed(1) }% of ${ gc }%`, over: pct > gc, pct, gc
      });
    });
    const over = items.filter((i) => i.over);

    return result('diskSpace', over.length ? 'block' : (unknown ? 'unknown' : 'pass'), { items: over.length ? over : items });
  }),

  machines: (s) => guarded('machines', s, ['nodes', 'machines'], () => {
    const items = s.machines.filter((m) => m.status.phase !== 'Running').map((m) => ({ text: m.metadata.name, note: `phase ${ m.status.phase || '?' }` }));
    const byName = Object.fromEntries(s.machines.map((m) => [m.metadata.name, m]));

    if (s.machines.length !== s.nodes.length) {
      items.push({ text: `${ s.nodes.length } nodes / ${ s.machines.length } machines` });
    }
    s.nodes.forEach((n) => {
      const mc = n.metadata.annotations?.['cluster.x-k8s.io/machine'];

      if (!mc) {
        items.push({ text: n.metadata.name, note: 'no machine annotation' });
      } else if (byName[mc]?.status.nodeRef !== n.metadata.name) {
        items.push({ text: n.metadata.name, note: `machine ${ mc } refers to ${ byName[mc]?.status.nodeRef || 'nothing' }` });
      }
    });

    return result('machines', items.length ? 'block' : 'pass', { items });
  }),

  singleReplica: (s) => guarded('singleReplica', s, ['nodes', 'lhVolumes', 'lhReplicas', 'vms'], () => {
    if (s.nodes.length === 1) {
      return result('singleReplica', 'skip');
    }
    const vmOf = pvcToVm(s.vms);
    const vols = s.lhVolumes.filter((v) => v.spec.numberOfReplicas === 1);
    const attached = vols.filter((v) => ['creating', 'attached', 'attaching'].includes(v.status.state));
    const detached = vols.filter((v) => !attached.includes(v));
    const replicasOf = (v) => s.lhReplicas.filter((r) => r.spec.volumeName === v.metadata.name);
    const item = (v) => {
      const reps = replicasOf(v);
      const healthy = reps.filter((r) => r.spec.healthyAt && !r.spec.failedAt).map((r) => r.spec.nodeID);
      // "Stuck" only next to a healthy copy: a never-attached volume's only replica is never marked healthy either.
      const stuckReps = healthy.length ? reps.filter((r) => !r.spec.healthyAt && !r.spec.failedAt) : [];
      const stuck = stuckReps.map((r) => r.spec.nodeID);
      const unused = healthy.length ? [] : reps.filter((r) => !r.spec.failedAt).map((r) => r.spec.nodeID);

      return {
        ...volumeItem(v, vmOf),
        replicaNodes:       healthy,
        stuckReplicaNodes:  stuck,
        unusedReplicaNodes: unused,
        // An extra replica that never became healthy next to a healthy one: not a usable copy; deleting it is safe.
        stuckReplicas:      stuckReps.map((r) => ({
          name: r.metadata.name, node: r.spec.nodeID, retries: r.spec.rebuildRetryCount || 0
        }))
      };
    };

    // With the dialog's skip option only attached volumes block; without it, all do.
    return result('singleReplica', attached.length ? 'block' : (detached.length ? 'warn' : 'pass'), {
      items: [...attached.map((v) => ({ ...item(v), attached: true })), ...detached.map((v) => ({ ...item(v), attached: false }))],
      fixes: [
        ...(attached.length ? [goto('goVms', { resource: TYPES.VM })] : []),
        ...(detached.length ? [{ kind: 'option', labelKey: 'optionSkipDetached' }] : [])
      ],
      args: { attached: attached.length, detached: detached.length }
    });
  }),

  nonMigratable: (s) => guarded('nonMigratable', s, ['nodes', 'vmis', 'upgradeConfig'], () => {
    if (restoreVM(s)) {
      return result('nonMigratable', 'skip', { args: { reason: 'restoreVM' } });
    }
    const nw = nonWitness(s.nodes);

    if (nw.length === 1) {
      return result('nonMigratable', 'skip', { args: { reason: 'single' } });
    }
    const items = nonMigratableItems(s, nw);

    return result('nonMigratable', items.length ? 'block' : 'pass', { items });
  }),

  hotplug: (s) => guarded('hotplug', s, ['nodes', 'vms', 'vmis', 'upgradeConfig'], () => {
    if (restoreVM(s) || nonWitness(s.nodes).length === 1) {
      return result('hotplug', 'skip');
    }
    const vms = Object.fromEntries(s.vms.map((v) => [nsName(v), v]));
    const items = s.vms.filter((v) => v.status.volumeRequests > 0).map((v) => ({
      text: nsName(v), note: 'pending hotplug request', link: link(TYPES.VM, v)
    }));

    s.vmis.filter((i) => i.status.phase === 'Running' && vms[nsName(i)]).forEach((i) => {
      const inSpec = new Set(vms[nsName(i)].spec.volumes.map((v) => v.name));

      i.spec.volumes.filter((v) => v.hotpluggable && !inSpec.has(v.name)).forEach((v) => items.push({
        text: nsName(i), note: `ephemeral hotplug volume ${ v.name }`, link: link(TYPES.VM, i)
      }));
    });

    return result('hotplug', items.length ? 'block' : 'pass', { items });
  }),

  certExpiry: (s) => guarded('certExpiry', s, ['certNotAfter'], () => {
    const days = Math.floor((Date.parse(s.certNotAfter) - (s.now ?? Date.now())) / DAY);

    return result('certExpiry', days > CERT_MIN_DAYS ? 'pass' : 'block', { args: { date: s.certNotAfter.slice(0, 10), days } });
  }),
  // ---- advisory: never block, but worth knowing before an upgrade ----

  etcdHealth: (s) => guarded('etcdHealth', s, ['etcdPods', 'machines'], () => {
    const etcdNodes = s.machines.filter((m) => m.metadata.labels?.['rke.cattle.io/etcd-role'] === 'true').map((m) => m.status.nodeRef).filter(Boolean);
    const items = etcdNodes.map((node) => {
      const p = s.etcdPods.find((x) => x.node === node);

      return {
        text: node, note: p ? `${ p.ready ? 'ready' : 'NOT ready' }, ${ p.restarts } restart(s)` : 'no etcd pod', bad: !p || !p.ready
      };
    });
    const bad = items.filter((x) => x.bad);

    return result('etcdHealth', bad.length ? 'warn' : 'pass', {
      items: bad.length ? bad : items, args: { n: etcdNodes.length }, advisory: true
    });
  }),

  failedMigrations: (s) => guarded('failedMigrations', s, ['vmims'], () => {
    const since = (s.now ?? Date.now()) - 7 * 24 * 3600 * 1000;
    const failed = s.vmims.filter((m) => m.phase === 'Failed' && Date.parse(m.metadata.creationTimestamp) >= since);

    return result('failedMigrations', failed.length ? 'warn' : 'pass', {
      items: failed.map((m) => ({
        text: `${ m.metadata.namespace }/${ m.vmi }`, note: `${ m.source || '?' } → ${ m.target || '?' }${ m.reason ? `: ${ m.reason }` : '' }`, link: link(TYPES.VM, { metadata: { namespace: m.metadata.namespace, name: m.vmi } })
      })),
      advisory: true
    });
  }),

  memoryHeadroom: (s) => guarded('memoryHeadroom', s, ['nodes', 'pods', 'vmis'], () => {
    const stay = new Set(nonWitness(s.nodes).length > 1 ? nonMigratableItems(s).map((i) => i.text) : []);
    const load = moveLoad(s.nodes, s.pods, stay);
    const gib = (b) => (b / 2 ** 30).toFixed(1);
    const items = Object.entries(load).filter(([, l]) => l.unplaced.length).map(([node, l]) => ({
      text:       node,
      reason:     'unplaced',
      reasonArgs: {
        n: l.unplaced.length, total: l.moving.length, targets: l.targets.join(', ') || '—', vms: l.unplaced.map((v) => `${ v.vm } (${ gib(v.memory) } GiB)`).join(', ')
      }
    }));

    return result('memoryHeadroom', items.length ? 'warn' : 'pass', { items, advisory: true });
  })
};

/** `nvidia.com/GB205_GEFORCE_RTX_5070` -> `GB205 GEFORCE RTX 5070` (the device plugin's resource name, readable). */
export function deviceName(resource) {
  return String(resource || '').split('/').pop().replace(/_/g, ' ');
}

/** `harvester-v1.9.0-amd64.iso` -> `v1.9.0` */
export function isoVersion(name) {
  const base = String(name || '').replace(/-(amd64|arm64|x86_64|aarch64)\.iso$/i, '').replace(/\.iso$/i, '');

  return base.match(/^harvester-(v\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)$/i)?.[1] || null;
}

/** Compares `v1.9.0`, `v1.8.2`, `v1.9.0-rc1` (a pre-release sorts before its release). */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v || '').replace(/^v/, '').split('-');

    return { nums: core.split('.').map((x) => Number(x) || 0), pre: pre || null };
  };
  const x = parse(a);
  const y = parse(b);

  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] || 0) !== (y.nums[i] || 0)) {
      return (x.nums[i] || 0) - (y.nums[i] || 0);
    }
  }
  if (x.pre === y.pre) {
    return 0;
  }
  if (!x.pre) {
    return 1;
  }
  if (!y.pre) {
    return -1;
  }

  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/** VMs that cannot live-migrate (webhook rule: node selector, PCI/USB device, or no other node matches its affinity). */
export function nonMigratableItems(s, nw = nonWitness(s.nodes)) {
  const items = [];

  s.vmis.forEach((i) => {
    const vm = { metadata: i.metadata };

    // Same order as the webhook. `reason` picks the plain-language explanation shown next to the VM.
    if (i.spec.nodeSelector) {
      items.push({
        text: nsName(i), reason: 'nodeSelector', reasonArgs: { selector: Object.entries(i.spec.nodeSelector).map(([a, b]) => `${ a }=${ b }`).join(', ') }, link: link(TYPES.VM, vm)
      });
    } else if (i.spec.hostDevices) {
      items.push({
        text: nsName(i), reason: 'device', reasonArgs: { devices: i.spec.hostDevices.map(deviceName).join(', ') }, link: link(TYPES.VM, vm)
      });
    } else {
      const req = i.spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution;
      const targets = nw.filter((n) => n.metadata.name !== i.status.nodeName);
      const ok = targets.some((n) => !n.spec.unschedulable && (!req || matchesTerms(n, req)));

      if (!ok) {
        items.push({
          text: nsName(i), reason: 'affinity', reasonArgs: {}, link: link(TYPES.VM, vm)
        });
      }
    }
  });

  return items;
}

function restoreVM(s) {
  try {
    return !!JSON.parse(s.upgradeConfig.value || s.upgradeConfig.default || '{}').restoreVM;
  } catch (e) {
    return false;
  }
}

function volumeItem(v, vmOf) {
  const ks = v.status.kubernetesStatus;
  const vm = vmOf[`${ ks.namespace }/${ ks.pvcName }`];
  const gib = v.spec.size ? Math.round(Number(v.spec.size) / 1024 ** 3) : null;

  return {
    text:  vm ? nsName(vm) : `${ ks.namespace }/${ ks.pvcName }`,
    disk:  vm ? ks.pvcName : '',
    note:  gib !== null ? `${ gib } GiB` : '',
    link:  vm ? link(TYPES.VM, vm) : {
      resource: TYPES.VOLUME, namespace: ks.namespace, id: ks.pvcName
    },
    volume: v.metadata.name,
    state:  v.status.state
  };
}

/** Order = blockers first, then warnings, unknown, skipped, passed; inside a group the webhook's order. */
export const ORDER = Object.keys(CHECKS);
const RANK = {
  block: 0, warn: 1, unknown: 2, skip: 3, pass: 4
};

export function runChecks(snapshot) {
  return ORDER.map((id) => {
    try {
      return CHECKS[id](snapshot);
    } catch (e) {
      return result(id, 'unknown', { args: { sources: e?.message || String(e) } });
    }
  }).sort((a, b) => (RANK[a.status] - RANK[b.status]) || (ORDER.indexOf(a.id) - ORDER.indexOf(b.id)));
}

export function verdict(results) {
  const n = (st) => results.filter((r) => r.status === st).length;

  return {
    block: n('block'), warn: n('warn'), unknown: n('unknown'), pass: n('pass'), skip: n('skip')
  };
}
