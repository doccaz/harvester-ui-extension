import { reactive } from 'vue';

/**
 * The only writes these pages make, behind a per-session switch (off by default, reset on reload) and an inline confirm.
 * Each one goes through the Harvester UI's own model (same API call as the product's own button). Changes that should be
 * undone after the upgrade (stopped VMs, suspended schedules) are remembered in this browser with an Undo.
 */
export const changes = reactive({ allowed: false });

const UNDO_KEY = 'harvester-upgrade-readiness/changed';
const VM = 'kubevirt.io.virtualmachine';
const SCHEDULE = 'harvesterhci.io.schedulevmbackup';
const UPGRADE = 'harvesterhci.io.upgrade';
const PAUSE_MAP = 'harvesterhci.io/node-upgrade-pause-map';

/** kind -> { type, undo } ; `target` is "ns/name" (VM, schedule), a node name, or { upgrade, node } for hold/release. */
export const ACTIONS = {
  stopVM:          { type: VM, undo: 'startVM' },
  restartVM:       { type: VM },
  startVM:         { type: VM },
  suspendSchedule: { type: SCHEDULE, undo: 'resumeSchedule' },
  resumeSchedule:  { type: SCHEDULE },
  uncordon:        { type: 'node' },
  holdNode:        { type: UPGRADE },
  releaseNode:     { type: UPGRADE }
};

export function readChanged() {
  try {
    return JSON.parse(window.localStorage.getItem(UNDO_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function writeChanged(list) {
  try {
    window.localStorage.setItem(UNDO_KEY, JSON.stringify(list));
  } catch (e) {} // private mode etc.: the list is a convenience only
}

export const changed = reactive({ list: readChanged() });

function remember(kind, target) {
  const undo = ACTIONS[kind]?.undo;

  if (undo) {
    changed.list = [...changed.list.filter((c) => !(c.target === target && c.kind === kind)), {
      kind, undo, target, at: new Date().toISOString()
    }];
    writeChanged(changed.list);
  }
}

export function forget(entry) {
  changed.list = changed.list.filter((c) => c !== entry && !(c.kind === entry.kind && c.target === entry.target));
  writeChanged(changed.list);
}

/** New pause map after holding/releasing `node` (pure, for tests). */
export function nextPauseMap(current, node, kind) {
  let map = {};

  try {
    map = JSON.parse(current || '{}');
  } catch (e) {}

  return { ...map, [node]: kind === 'holdNode' ? 'pause' : 'unpause' };
}

/**
 * Runs one action. Throws on failure (the caller shows the error).
 * @param store vuex store; @param inStore the Harvester store name
 */
export async function runAction(store, inStore, kind, target) {
  if (!changes.allowed) {
    throw new Error('changes are not allowed in this session');
  }
  const { type } = ACTIONS[kind];
  const find = (id) => store.dispatch(`${ inStore }/find`, {
    type, id, opt: { force: true }
  });

  switch (kind) {
  case 'stopVM':
  case 'restartVM':
  case 'startVM': {
    const vm = await find(target);

    await vm.doAction(kind.replace('VM', ''), {});
    break;
  }
  case 'suspendSchedule':
  case 'resumeSchedule': {
    const sched = await find(target);

    sched.spec.suspend = kind === 'suspendSchedule';
    await sched.save();
    break;
  }
  case 'uncordon': {
    const node = await find(target);

    await node.doAction('uncordon', {});
    break;
  }
  case 'holdNode':
  case 'releaseNode': {
    const up = await find(`harvester-system/${ target.upgrade }`);

    up.setAnnotation(PAUSE_MAP, JSON.stringify(nextPauseMap(up.metadata?.annotations?.[PAUSE_MAP], target.node, kind)));
    await up.save();
    break;
  }
  default:
    throw new Error(`unknown action ${ kind }`);
  }
  remember(kind, typeof target === 'string' ? target : `${ target.upgrade }/${ target.node }`);
}
