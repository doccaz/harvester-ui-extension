/**
 * Upgrade plan preview (read-only): in which order the nodes will be upgraded, which ones will wait for the user, and
 * whether each node's VMs can move away. Pure.
 *
 * Order (Rancher v2.14 planner, pkg/capr/planner/planner.go): the etcd init node first; then the other etcd nodes one at a
 * time, sorted by CAPI machine name; then control-plane nodes, then workers (Harvester sets both concurrencies to 1).
 * A node that is paused blocks its tier: the pause map gives checkpoints between nodes, it cannot change this order.
 *
 * Pauses (Harvester v1.8.2): `upgrade-config` is read once, when the Upgrade is created (manual mode: `pauseNodes`, or all
 * nodes when empty; unknown names are dropped). During an upgrade, its `harvesterhci.io/node-upgrade-pause-map` rules.
 */
import { WITNESS_LABEL } from './checks';

const ROLE = {
  etcd: 'rke.cattle.io/etcd-role', cp: 'rke.cattle.io/control-plane-role', worker: 'rke.cattle.io/worker-role'
};
const yes = (labels, key) => labels?.[key] === 'true';

export const PAUSE_MAP = 'harvesterhci.io/node-upgrade-pause-map';

export function predictOrder(machines = [], planSecrets = [], nodes = []) {
  const initMachine = planSecrets.find((p) => yes(p.metadata.labels, 'rke.cattle.io/init-node'))?.metadata.labels['rke.cattle.io/machine-name'] || null;
  const byNode = Object.fromEntries(nodes.map((n) => [n.metadata.name, n]));
  const entries = machines.filter((m) => m.status.nodeRef).map((m) => {
    const l = m.metadata.labels || {};

    return {
      node:    m.status.nodeRef,
      machine: m.metadata.name,
      roles:   {
        etcd: yes(l, ROLE.etcd), cp: yes(l, ROLE.cp), worker: yes(l, ROLE.worker)
      },
      init:    m.metadata.name === initMachine,
      witness: WITNESS_LABEL in (byNode[m.status.nodeRef]?.metadata.labels || {})
    };
  });
  const byMachine = (a, b) => a.machine.localeCompare(b.machine);
  const tiers = [
    ['init', entries.filter((e) => e.init)],
    ['etcd', entries.filter((e) => !e.init && e.roles.etcd).sort(byMachine)],
    ['controlPlane', entries.filter((e) => !e.init && !e.roles.etcd && e.roles.cp).sort(byMachine)],
    ['worker', entries.filter((e) => !e.init && !e.roles.etcd && !e.roles.cp).sort(byMachine)]
  ];
  const ordered = tiers.flatMap(([tier, list]) => list.map((e) => ({ ...e, tier })));
  // Nodes without a machine (should not happen on Harvester) are listed last, unordered.
  const missing = nodes.filter((n) => !ordered.some((e) => e.node === n.metadata.name)).map((n) => ({
    node: n.metadata.name, machine: null, roles: {}, init: false, witness: WITNESS_LABEL in (n.metadata.labels || {}), tier: 'unknown'
  }));

  return [...ordered, ...missing].map((e, i) => ({ ...e, position: i + 1 }));
}

/** The upgrade that is running now (not Succeeded/Failed), if any. */
export function activeUpgrade(upgrades = []) {
  return upgrades.find((u) => !['Succeeded', 'Failed'].includes(u.metadata.labels?.['harvesterhci.io/upgradeState'])) || null;
}

export function pausePlan(upgradeConfig, nodes = [], upgrades = []) {
  const names = nodes.map((n) => n.metadata.name);
  const running = activeUpgrade(upgrades);

  if (running) {
    let map = {};

    try {
      map = JSON.parse(running.metadata.annotations?.[PAUSE_MAP] || '{}');
    } catch (e) {}

    return {
      source: 'upgrade', upgrade: running.metadata.name, mode: Object.keys(map).length ? 'manual' : 'auto', paused: names.filter((n) => map[n] === 'pause'), released: names.filter((n) => map[n] === 'unpause'), ignored: []
    };
  }
  let cfg = {};

  try {
    cfg = JSON.parse(upgradeConfig?.value || upgradeConfig?.default || '{}');
  } catch (e) {}
  const strategy = cfg?.nodeUpgradeOption?.strategy || {};

  if (strategy.mode !== 'manual') {
    return {
      source: 'setting', mode: 'auto', paused: [], released: [], ignored: []
    };
  }
  const listed = strategy.pauseNodes || [];

  return {
    source:   'setting',
    mode:     'manual',
    paused:   listed.length ? names.filter((n) => listed.includes(n)) : names,
    released: [],
    ignored:  listed.filter((n) => !names.includes(n))
  };
}

/**
 * For each node: the VMs that must move off it and whether they fit on the other nodes (witness and cordoned nodes excluded),
 * by memory requests (virt-launcher pod as the scheduler counts it) against free allocatable memory now. First-fit
 * decreasing; an approximation (CPU, affinity, devices and VMs moving between steps are not modelled).
 * `stay` = VMs that cannot live-migrate (shut down instead), by "ns/name".
 */
export function moveLoad(nodes = [], pods = [], stay = new Set()) {
  const used = {};

  pods.forEach((p) => {
    used[p.node] = (used[p.node] || 0) + (p.memory || 0);
  });
  const targetsFor = (name) => nodes.filter((n) => n.metadata.name !== name && !n.spec.unschedulable && !(WITNESS_LABEL in (n.metadata.labels || {})));

  return Object.fromEntries(nodes.map((n) => {
    const name = n.metadata.name;
    const vms = pods.filter((p) => p.node === name && p.vm).map((p) => ({ vm: `${ p.namespace }/${ p.vm }`, memory: p.memory || 0 }));
    const moving = vms.filter((v) => !stay.has(v.vm)).sort((a, b) => b.memory - a.memory);
    const free = Object.fromEntries(targetsFor(name).map((t) => [t.metadata.name, (t.status.allocatableMemory || 0) - (used[t.metadata.name] || 0)]));
    const unplaced = [];

    moving.forEach((v) => {
      const best = Object.entries(free).sort((a, b) => b[1] - a[1])[0];

      if (best && best[1] >= v.memory) {
        free[best[0]] -= v.memory;
      } else {
        unplaced.push(v);
      }
    });

    return [name, {
      moving, staying: vms.filter((v) => stay.has(v.vm)), totalBytes: moving.reduce((a, v) => a + v.memory, 0), unplaced, targets: Object.keys(free)
    }];
  }));
}

/** Short notes for the plan (keys + args for l10n). */
export function planNotes(order, pause) {
  const notes = [];
  const paused = new Set(pause.paused);

  if (order.length === 1) {
    notes.push({ key: 'singleNode' });
  }
  if (pause.source === 'setting' && pause.mode === 'manual') {
    notes.push({ key: 'readAtStart' });
  }
  if (pause.ignored.length) {
    notes.push({ key: 'ignored', args: { nodes: pause.ignored.join(', ') } });
  }
  const firstPaused = order.find((e) => paused.has(e.node));

  if (firstPaused && firstPaused.position > 1) {
    notes.push({ key: 'runsUntil', args: { nodes: order.slice(0, firstPaused.position - 1).map((e) => e.node).join(', '), node: firstPaused.node } });
  }

  return notes;
}
