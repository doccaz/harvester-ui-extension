/**
 * Live view of a running upgrade: where it is and, per node, why it is waiting. Pure.
 * Sources (Harvester v1.8.2 pkg/controller/master/upgrade, Rancher v2.14 pkg/capr): the Upgrade's state label, conditions and
 * `status.nodeStatuses`; the upgrade jobs (labels `harvesterhci.io/upgrade`, `upgradeJobType`, `harvesterhci.io/node`);
 * the machine plan secrets' drain annotations (Rancher is working on a node while `rke.cattle.io/pre-drain` or `post-drain`
 * is set on its plan secret); running VM migrations.
 */
import { activeUpgrade } from './plan';

// Overall phases in the order they happen (conditions on the Upgrade).
export const PHASES = ['ImageReady', 'RepoReady', 'NodesPrepared', 'SystemServicesUpgraded', 'NodesUpgraded', 'Completed'];

// Node states written by the upgrade controller -> the plain-language "why" key.
const WHY = {
  '':                    'notStarted',
  'Images preloading':   'preloading',
  'Images preloaded':    'waitingTurn',
  'Node-upgrade paused': 'paused',
  'Pre-draining':        'preDraining',
  'Pre-drained':         'preDrained',
  'Post-draining':       'postDraining',
  'Waiting Reboot':      'rebooting',
  Succeeded:             'done',
  Failed:                'failed'
};

function phaseStatus(upgrade) {
  const conds = Object.fromEntries((upgrade.status.conditions || []).map((c) => [c.type, c]));

  return PHASES.filter((p) => conds[p] || p !== 'NodesPrepared').map((p) => ({
    key:     p,
    status:  conds[p]?.status === 'True' ? 'done' : (conds[p]?.status === 'False' ? 'failed' : (conds[p] ? 'running' : 'pending')),
    message: conds[p]?.message || conds[p]?.reason || ''
  }));
}

/** Node name -> is Rancher draining it right now (pre/post-drain hook pending on its plan secret)? */
function rancherWorkingOn(planSecrets = [], machines = []) {
  const nodeOf = Object.fromEntries(machines.map((m) => [m.metadata.name, m.status.nodeRef]));
  const out = {};

  planSecrets.forEach((p) => {
    const a = p.metadata.annotations || {};
    const node = nodeOf[p.metadata.labels?.['rke.cattle.io/machine-name']];

    if (node) {
      out[node] = !!(a['rke.cattle.io/pre-drain'] || a['rke.cattle.io/post-drain'] || a['rke.cattle.io/drain-options'] || a['rke.cattle.io/uncordon']);
    }
  });

  return out;
}

export function liveStatus(snap) {
  const upgrade = activeUpgrade(snap.upgrades || []);

  if (!upgrade) {
    return null;
  }
  const draining = rancherWorkingOn(snap.planSecrets, snap.machines);
  const jobs = (snap.jobs || []).filter((j) => j.upgrade === upgrade.metadata.name);
  const migrations = (snap.vmims || []).filter((m) => !['Succeeded', 'Failed'].includes(m.phase));
  const nodes = {};

  (snap.nodes || []).forEach((n) => {
    const name = n.metadata.name;
    const st = upgrade.status.nodeStatuses?.[name] || {};
    let why = WHY[st.state || ''] || 'other';

    // "Images preloaded" means waiting for Rancher to reach this node, unless Rancher is already draining it.
    if (why === 'waitingTurn' && draining[name]) {
      why = 'rancherDraining';
    }
    const nodeJobs = jobs.filter((j) => j.node === name).sort((a, b) => String(b.started).localeCompare(String(a.started)));

    nodes[name] = {
      state:           st.state || '',
      reason:          st.reason || '',
      message:         st.message || '',
      why,
      job:             nodeJobs[0] || null,
      migrations:      migrations.filter((m) => m.source === name).map((m) => `${ m.metadata.namespace }/${ m.vmi } → ${ m.target || '?' }`),
      rancherDraining: !!draining[name]
    };
  });

  return {
    name:   upgrade.metadata.name,
    state:  upgrade.metadata.labels?.['harvesterhci.io/upgradeState'] || '',
    to:     upgrade.spec.version || '',
    phases: phaseStatus(upgrade),
    nodes
  };
}

/** Copyable command to read an upgrade job's log. */
export const jobLogCommand = (job) => `kubectl -n harvester-system logs job/${ job.name } --all-containers`;
