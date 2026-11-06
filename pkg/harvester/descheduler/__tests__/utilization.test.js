import {
  classify, isActivePod, nodeUsage, podRequests, verdict
} from '../utils/utilization';
const pod = (node, cpu, mem, phase = 'Running', extra = {}) => ({
  spec:   {
    nodeName: node, containers: [{ resources: { requests: { cpu, memory: mem } } }], ...extra
  },
  status: { phase }
});
const node = (name, cpu, mem) => ({ metadata: { name }, status: { allocatable: { cpu, memory: mem } } });
const T = {
  thresholds:       { cpu: 30, memory: 30 },
  targetThresholds: { cpu: 50, memory: 50 }
};

describe('podRequests', () => {
  it('sums app containers', () => {
    const p = { spec: { containers: [{ resources: { requests: { cpu: '100m', memory: '1Gi' } } }, { resources: { requests: { cpu: '200m', memory: '1Gi' } } }] } };

    expect(podRequests(p)).toStrictEqual({ cpu: 300, memory: 2 * 1024 ** 3 });
  });
  it('uses the largest init container when it exceeds the app total', () => {
    const p = {
      spec: {
        initContainers: [{ resources: { requests: { cpu: '1', memory: '4Gi' } } }],
        containers:     [{ resources: { requests: { cpu: '100m', memory: '1Gi' } } }]
      }
    };

    expect(podRequests(p)).toStrictEqual({ cpu: 1000, memory: 4 * 1024 ** 3 });
  });
  it('ignores restartable init containers (sidecars), like descheduler 0.33 does', () => {
    const p = {
      spec: {
        initContainers: [{ restartPolicy: 'Always', resources: { requests: { cpu: '5m', memory: '35M' } } }],
        containers:     [{ resources: { requests: { cpu: '100m', memory: '1Gi' } } }]
      }
    };

    // a modern-Kubernetes calculation would give 105m / 1Gi + 35M
    expect(podRequests(p)).toStrictEqual({ cpu: 100, memory: 1024 ** 3 });
  });
  it('adds pod overhead and tolerates missing requests', () => {
    const p = { spec: { containers: [{}], overhead: { cpu: '250m', memory: '120Mi' } } };

    expect(podRequests(p)).toStrictEqual({ cpu: 250, memory: 120 * 1024 ** 2 });
  });
});
describe('nodeUsage', () => {
  it('counts only active pods assigned to the node, as a percentage of allocatable', () => {
    const n = node('a', '10', '100Gi');
    const pods = [
      pod('a', '2', '20Gi'),
      pod('a', '1', '10Gi', 'Pending'),
      pod('a', '4', '40Gi', 'Succeeded'), // finished: holds nothing
      pod('a', '4', '40Gi', 'Failed'),
      pod('b', '9', '90Gi')
    ];
    const u = nodeUsage(n, pods);

    expect(u.pods).toBe(2);
    expect(u.requests).toStrictEqual({ cpu: 3000, memory: 30 * 1024 ** 3 });
    expect(u.cpuPct).toBe(30);
    expect(u.memoryPct).toBe(30);
  });
  it('does not divide by zero on a node with no allocatable', () => {
    expect(nodeUsage(node('z', '0', '0'), [pod('z', '1', '1Gi')]).cpuPct).toBe(0);
  });
  it('knows which phases are terminal', () => {
    expect(isActivePod({ status: { phase: 'Running' } })).toBe(true);
    expect(isActivePod({ status: { phase: 'Succeeded' } })).toBe(false);
  });
});
describe('classify (LowNodeUtilization semantics)', () => {
  const u = (cpuPct, memoryPct) => ({
    name: 'n', allocatable: { cpu: 0, memory: 0 }, requests: { cpu: 0, memory: 0 }, pods: 0, cpuPct, memoryPct
  });

  it('is under only when EVERY resource is below its threshold', () => {
    expect(classify(u(10, 10), T)).toBe('under');
    expect(classify(u(10, 30), T)).toBe('appropriate'); // not strictly below 30
    expect(classify(u(10, 40), T)).toBe('appropriate');
  });
  it('is over when ANY resource is above its target', () => {
    expect(classify(u(10, 51), T)).toBe('over');
    expect(classify(u(40, 50), T)).toBe('appropriate'); // not strictly above 50
    expect(classify(u(51, 10), T)).toBe('over');
  });
  it('only considers resources named in thresholds', () => {
    const cpuOnly = { thresholds: { cpu: 30 }, targetThresholds: { cpu: 50 } };

    expect(classify(u(10, 99), cpuOnly)).toBe('under');
  });
});
describe('verdict', () => {
  const mk = (name, cpuPct, memoryPct) => ({
    name, allocatable: { cpu: 0, memory: 0 }, requests: { cpu: 0, memory: 0 }, pods: 0, cpuPct, memoryPct
  });

  it('reports nothing will move when no node is underutilized (the lab case)', () => {
    const v = verdict([mk('harv01lab', 40, 63), mk('harv02lab', 69, 92)], T);

    expect(v.key).toBe('noUnder');
    expect(v.over).toStrictEqual(['harv01lab', 'harv02lab']);
  });
  it('reports nothing to move when no node is over target', () => {
    expect(verdict([mk('a', 10, 10), mk('b', 40, 40)], T).key).toBe('noOver');
  });
  it('would act with one under and one over node', () => {
    const v = verdict([mk('a', 10, 10), mk('b', 60, 60)], T);

    expect(v).toStrictEqual({
      key: 'wouldAct', under: ['a'], over: ['b']
    });
  });
  it('honours numberOfNodes (too few underutilized nodes)', () => {
    const v = verdict([mk('a', 10, 10), mk('b', 60, 60)], { ...T, numberOfNodes: 1 });

    expect(v.key).toBe('tooFewUnder');
  });
  it('handles a missing policy', () => {
    expect(verdict([mk('a', 1, 1)], null).key).toBe('noPolicy');
  });
});
describe('threshold edges', () => {
  const T = { thresholds: { cpu: 30, memory: 30 }, targetThresholds: { cpu: 50, memory: 50 } };
  const u = (cpuPct, memoryPct) => ({
    name: 'n', allocatable: { cpu: 0, memory: 0 }, requests: { cpu: 0, memory: 0 }, pods: 0, cpuPct, memoryPct
  });

  it('keeps the exact percentage, so 29.6% is underutilized against a 30% threshold', () => {
    expect(nodeUsage(node('a', '1000', '1000'), [pod('a', '296', '296')]).cpuPct).toBeCloseTo(29.6);
    expect(classify(u(29.6, 29.6), T)).toBe('under');
    expect(classify(u(50.4, 10), T)).toBe('over');
  });
  it('gives no prediction in deviation mode', () => {
    expect(verdict([u(10, 10), u(90, 90)], { ...T, useDeviationThresholds: true }).key).toBe('deviation');
  });
});
