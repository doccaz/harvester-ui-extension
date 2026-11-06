import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import lab from './fixtures/lab-2026-11-06.json';
import { runChecks } from '../utils/checks';
import {
  changed, changes, forget, nextPauseMap, runAction
} from '../utils/actions';
import ConfirmAction from '../components/ConfirmAction.vue';

const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = (r) => Object.fromEntries(r.map((c) => [c.id, c]));

/** A fake store: `find` returns one model per id, recording what was called on it. */
function fakeStore(models = {}) {
  const calls = [];
  const model = (id) => {
    models[id] = models[id] || {
      id,
      spec:     {},
      metadata: { annotations: {} },
      doAction: jest.fn(async(a) => calls.push(`${ id }:action:${ a }`)),
      save:     jest.fn(async() => calls.push(`${ id }:save`)),
      setAnnotation(k, v) {
        this.metadata.annotations[k] = v;
      }
    };

    return models[id];
  };

  return {
    calls,
    models,
    getters:  { currentProduct: { inStore: 'harvester' }, 'i18n/t': (k) => k },
    dispatch: jest.fn(async(action, { id }) => model(id))
  };
}

// Each test starts with changes off and an empty "changed" list (the repo's lint rules do not allow beforeEach).
function reset() {
  changes.allowed = false;
  changed.list.slice().forEach(forget);
  window.localStorage.clear();
}

describe('runAction', () => {
  it('refuses everything while changes are not allowed', async() => {
    reset();
    const store = fakeStore();

    await expect(runAction(store, 'harvester', 'stopVM', 'labs/vm1')).rejects.toThrow('not allowed');
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('stops a VM through its model and remembers it for undo', async() => {
    reset();
    changes.allowed = true;
    const store = fakeStore();

    await runAction(store, 'harvester', 'stopVM', 'labs/vm1');
    expect(store.calls).toStrictEqual(['labs/vm1:action:stop']);
    expect(changed.list.map((c) => `${ c.kind }>${ c.undo }:${ c.target }`)).toStrictEqual(['stopVM>startVM:labs/vm1']);
    expect(JSON.parse(window.localStorage.getItem('harvester-upgrade-readiness/changed'))).toHaveLength(1);
  });

  it('suspends a schedule by saving spec.suspend', async() => {
    reset();
    changes.allowed = true;
    const store = fakeStore();

    await runAction(store, 'harvester', 'suspendSchedule', 'labs/s1');
    expect(store.models['labs/s1'].spec.suspend).toBe(true);
    expect(store.calls).toStrictEqual(['labs/s1:save']);
  });

  it('undo: resuming a schedule sets spec.suspend back to false', async() => {
    reset();
    changes.allowed = true;
    const store = fakeStore();

    await runAction(store, 'harvester', 'suspendSchedule', 'labs/s1');
    await runAction(store, 'harvester', 'resumeSchedule', 'labs/s1');
    expect(store.models['labs/s1'].spec.suspend).toBe(false);
  });

  it('holds and releases a node in the running upgrade pause map, keeping the other entries', async() => {
    reset();
    changes.allowed = true;
    const store = fakeStore();
    const id = 'harvester-system/hvst-upgrade-new';

    store.dispatch(`harvester/find`, { id }); // create the model first
    store.models[id].metadata.annotations['harvesterhci.io/node-upgrade-pause-map'] = '{"harv01lab":"unpause"}';
    await runAction(store, 'harvester', 'holdNode', { upgrade: 'hvst-upgrade-new', node: 'harv02lab' });
    expect(JSON.parse(store.models[id].metadata.annotations['harvesterhci.io/node-upgrade-pause-map'])).toStrictEqual({ harv01lab: 'unpause', harv02lab: 'pause' });
    await runAction(store, 'harvester', 'releaseNode', { upgrade: 'hvst-upgrade-new', node: 'harv02lab' });
    expect(JSON.parse(store.models[id].metadata.annotations['harvesterhci.io/node-upgrade-pause-map']).harv02lab).toBe('unpause');
    expect(changed.list).toHaveLength(0); // nothing to undo for hold/release
  });

  it('builds pause maps from bad or empty annotations', () => {
    reset();
    expect(nextPauseMap(undefined, 'a', 'holdNode')).toStrictEqual({ a: 'pause' });
    expect(nextPauseMap('not json', 'a', 'releaseNode')).toStrictEqual({ a: 'unpause' });
  });
});

describe('actions offered by the checks', () => {
  const r = byId(runChecks(lab));

  it('offers Stop VM for in-use single-copy volumes and for VMs that cannot migrate', () => {
    reset();
    expect(r.singleReplica.items.filter((i) => i.actions).map((i) => i.actions[0].target).sort()).toStrictEqual(['labs/downstream-01', 'labs/sles16-01', 'labs/smlm-prod']);
    expect(r.nonMigratable.items[0].actions).toStrictEqual([{ kind: 'stopVM', target: 'labs/gpu-node' }]);
  });

  it('offers Uncordon for a cordoned node, but not for one in maintenance mode', () => {
    reset();
    const s = clone(lab);

    s.nodes[0].spec.unschedulable = true;
    s.nodes[1].spec.unschedulable = true;
    s.nodes[1].metadata.annotations['harvesterhci.io/maintain-status'] = 'completed';
    const items = byId(runChecks(s)).nodesReady.items;

    expect(items[0].actions).toStrictEqual([{ kind: 'uncordon', target: s.nodes[0].metadata.name }]);
    expect(items[1].actions).toStrictEqual([]);
  });

  it('offers Suspend for active schedules', () => {
    reset();
    const s = clone(lab);

    s.schedules[0].status.suspended = false;
    expect(byId(runChecks(s)).schedulesActive.items[0].actions[0].kind).toBe('suspendSchedule');
  });
});

jest.mock('vuex', () => {
  const store = { getters: { currentProduct: { inStore: 'harvester' }, 'i18n/t': (k) => k }, dispatch: jest.fn() };

  return { useStore: () => store, __store: store };
});

describe('confirmAction', () => {
  it('is not shown while changes are off', () => {
    reset();
    const w = mount(ConfirmAction, {
      props: {
        kind: 'stopVM', target: 'labs/vm1', label: 'Stop VM'
      }
    });

    expect(w.find('button').exists()).toBe(false);
  });

  it('asks before acting, and Cancel does nothing', async() => {
    reset();
    changes.allowed = true;
    const { __store: store } = jest.requireMock('vuex');

    store.dispatch.mockClear();
    const w = mount(ConfirmAction, {
      props: {
        kind: 'stopVM', target: 'labs/vm1', label: 'Stop VM'
      }
    });

    await w.find('button').trigger('click');
    expect(w.text()).toContain('action.confirm.stopVM');
    expect(store.dispatch).not.toHaveBeenCalled();
    await w.findAll('button')[1].trigger('click'); // Cancel
    await nextTick();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(w.find('button').text()).toBe('Stop VM');
  });
});
