import lab from './fixtures/lab-2026-11-06.json';
import { moveLoad, pausePlan, planNotes, predictOrder } from '../utils/plan';
import { parseBytes, podMemoryRequest } from '../utils/trim';

const clone = (o) => JSON.parse(JSON.stringify(o));
const GI = 2 ** 30;

describe('predictOrder', () => {
  it('lab: the witness is the init node, so it goes first; then the etcd nodes by machine name', () => {
    const order = predictOrder(lab.machines, lab.planSecrets, lab.nodes);

    expect(order.map((e) => [e.position, e.node, e.tier])).toStrictEqual([
      [1, 'harvlab-witness', 'init'], [2, 'harv01lab', 'etcd'], [3, 'harv02lab', 'etcd']
    ]);
    expect(order[0].witness).toBe(true);
  });

  it('orders by machine name, not by the order the API lists machines', () => {
    const shuffled = [...lab.machines].reverse();

    expect(predictOrder(shuffled, lab.planSecrets, lab.nodes).map((e) => e.machine)).toStrictEqual(['custom-947cfec563ba', 'custom-0610da1121f5', 'custom-f9fee6fbccfb']);
  });

  it('when another node is the init node, the witness is NOT first (pausing cannot change that)', () => {
    const ps = clone(lab.planSecrets).map((p) => {
      p.metadata.labels['rke.cattle.io/init-node'] = p.metadata.labels['rke.cattle.io/machine-name'] === 'custom-f9fee6fbccfb' ? 'true' : undefined;

      return p;
    });

    expect(predictOrder(lab.machines, ps, lab.nodes).map((e) => e.node)).toStrictEqual(['harv02lab', 'harv01lab', 'harvlab-witness']);
  });

  it('puts control-plane-only and worker-only nodes after the etcd tier', () => {
    const m = (name, node, roles) => ({ metadata: { name, labels: Object.fromEntries(roles.map((r) => [`rke.cattle.io/${ r }-role`, 'true'])) }, status: { nodeRef: node } });
    const machines = [m('a-w', 'w1', ['worker']), m('b-cp', 'cp1', ['control-plane']), m('c-e', 'e1', ['etcd', 'control-plane']), m('d-e', 'e2', ['etcd'])];
    const nodes = ['w1', 'cp1', 'e1', 'e2'].map((n) => ({ metadata: { name: n, labels: {} } }));
    const ps = [{ metadata: { labels: { 'rke.cattle.io/init-node': 'true', 'rke.cattle.io/machine-name': 'd-e' } } }];

    expect(predictOrder(machines, ps, nodes).map((e) => `${ e.node }:${ e.tier }`)).toStrictEqual(['e2:init', 'e1:etcd', 'cp1:controlPlane', 'w1:worker']);
  });
});

describe('pausePlan', () => {
  const cfg = (strategy) => ({ value: JSON.stringify({ nodeUpgradeOption: { strategy } }) });

  it('lab default: auto, nobody waits', () => {
    expect(pausePlan(lab.upgradeConfig, lab.nodes, lab.upgrades)).toMatchObject({
      source: 'setting', mode: 'auto', paused: []
    });
  });

  it('manual without a list pauses every node', () => {
    expect(pausePlan(cfg({ mode: 'manual' }), lab.nodes, lab.upgrades).paused.sort()).toStrictEqual(['harv01lab', 'harv02lab', 'harvlab-witness']);
  });

  it('manual with a list pauses those nodes and reports unknown names (the webhook drops them)', () => {
    const p = pausePlan(cfg({ mode: 'manual', pauseNodes: ['harv02lab', 'harv03lab'] }), lab.nodes, lab.upgrades);

    expect(p.paused).toStrictEqual(['harv02lab']);
    expect(p.ignored).toStrictEqual(['harv03lab']);
  });

  it('during an upgrade, its pause map rules, not the setting', () => {
    const ups = clone(lab.upgrades);

    ups[0].metadata.labels['harvesterhci.io/upgradeState'] = 'UpgradingNodes';
    ups[0].metadata.annotations['harvesterhci.io/node-upgrade-pause-map'] = JSON.stringify({ 'harvlab-witness': 'unpause', harv01lab: 'pause' });
    const p = pausePlan(cfg({ mode: 'manual' }), lab.nodes, ups);

    expect(p).toMatchObject({
      source: 'upgrade', paused: ['harv01lab'], released: ['harvlab-witness']
    });
  });

  it('notes that the upgrade runs through earlier nodes until the first paused one', () => {
    const order = predictOrder(lab.machines, lab.planSecrets, lab.nodes);
    const notes = planNotes(order, pausePlan(cfg({ mode: 'manual', pauseNodes: ['harv02lab'] }), lab.nodes, lab.upgrades));

    expect(notes).toContainEqual({ key: 'runsUntil', args: { nodes: 'harvlab-witness, harv01lab', node: 'harv02lab' } });
    expect(notes).toContainEqual({ key: 'readAtStart' });
  });
});

describe('moveLoad', () => {
  const load = moveLoad(lab.nodes, lab.pods, new Set(['labs/gpu-node']));

  it('the witness has nothing to move', () => {
    expect(load['harvlab-witness'].moving).toStrictEqual([]);
  });

  it('vMs that cannot migrate stay (shut down) and are not counted as moving', () => {
    expect(load.harv01lab.staying.map((v) => v.vm)).toStrictEqual(['labs/gpu-node']);
    expect(load.harv01lab.moving.map((v) => v.vm)).not.toContain('labs/gpu-node');
    expect(load.harv01lab.targets).toStrictEqual(['harv02lab']);
  });

  it('reports VMs that do not fit, largest first', () => {
    const nodes = clone(lab.nodes);

    nodes.find((n) => n.metadata.name === 'harv02lab').status.allocatableMemory = 0;
    const l = moveLoad(nodes, lab.pods, new Set());

    expect(l.harv01lab.unplaced).toHaveLength(l.harv01lab.moving.length);
  });
});

describe('quantities', () => {
  it('parses Kubernetes memory quantities', () => {
    expect(parseBytes('16Gi')).toBe(16 * GI);
    expect(parseBytes('7021Mi')).toBe(7021 * 2 ** 20);
    expect(parseBytes('96407744Ki')).toBe(96407744 * 1024);
    expect(parseBytes('1G')).toBe(1e9);
    expect(parseBytes('bogus')).toBeNull();
  });

  it('counts a pod like the scheduler: max(containers, largest init) + overhead', () => {
    const pod = {
      spec: {
        containers:     [{ resources: { requests: { memory: '1Gi' } } }, { resources: { requests: { memory: '1Gi' } } }],
        initContainers: [{ resources: { requests: { memory: '3Gi' } } }],
        overhead:       { memory: '100Mi' }
      }
    };

    expect(podMemoryRequest(pod)).toBe(3 * GI + 100 * 2 ** 20);
  });
});
