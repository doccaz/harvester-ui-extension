import { podFitsNode } from './fit';
import {
  classify, isActivePod, nodeUsage, percent, podRequests
} from './utilization';
const QOS_RANK = {
  BestEffort: 0, Burstable: 1, Guaranteed: 2
};

export const isLauncher = (p) => p?.metadata?.labels?.['kubevirt.io'] === 'virt-launcher';
export const vmName = (p) => p?.metadata?.labels?.['vm.kubevirt.io/name'] || p?.metadata?.name;
export const sortKey = (p) => [p?.spec?.priority ?? 0, QOS_RANK[p?.status?.qosClass] ?? 1];
function recompute(u) {
  return {
    ...u, cpuPct: percent(u.requests.cpu, u.allocatable.cpu), memoryPct: percent(u.requests.memory, u.allocatable.memory)
  };
}
/** The descheduler refuses to start when a low threshold is above its target ("thresholds' cpu percentage is greater than targetThresholds'"). */
export function thresholdsValid(t) {
  return ['cpu', 'memory'].every((r) => {
    const low = t.thresholds[r];
    const target = t.targetThresholds[r];

    return low === undefined || target === undefined || low <= target;
  });
}
export function simulate(nodes, pods, t, opts) {
  const before = nodes.map((n) => nodeUsage(n, pods));
  const result = {
    reason: 'ran', evictions: [], before, after: before, skipped: [], movable: {}
  };
  const resources = ['cpu', 'memory'].filter((r) => t.thresholds[r] !== undefined);

  if (resources.length === 0) {
    return { ...result, reason: 'noThresholds' };
  }
  if (!thresholdsValid(t)) {
    return { ...result, reason: 'invalidThresholds' };
  }
  const usage = new Map(before.map((u) => [u.name, { ...u, requests: { ...u.requests } }]));
  const bands = (name) => classify(usage.get(name), t);
  const under = before.filter((u) => classify(u, t) === 'under').map((u) => u.name);
  const over = before.filter((u) => classify(u, t) === 'over').map((u) => u.name);

  if (under.length === 0) {
    return { ...result, reason: 'noUnder' };
  }
  if (t.numberOfNodes && under.length <= t.numberOfNodes) {
    return { ...result, reason: 'tooFewUnder' };
  }
  if (over.length === 0) {
    return { ...result, reason: 'noOver' };
  }
  const roomOf = (name) => {
    const u = usage.get(name);
    const room = (r) => (t.targetThresholds[r] === undefined ? Infinity : (u.allocatable[r] * t.targetThresholds[r]) / 100 - u.requests[r]);

    return { cpu: room('cpu'), memory: room('memory') };
  };
  const total = under.reduce((acc, n) => {
    const r = roomOf(n);

    return { cpu: acc.cpu + r.cpu, memory: acc.memory + r.memory };
  }, { cpu: 0, memory: 0 });
  const roomLeft = () => resources.every((r) => total[r] > 0);
  const aboveTarget = (name) => resources.some((r) => {
    const u = usage.get(name);
    const limit = t.targetThresholds[r];

    return limit !== undefined && (r === 'cpu' ? u.cpuPct : u.memoryPct) > limit;
  });
  const sources = [...over].sort((a, b) => {
    const ua = usage.get(a);
    const ub = usage.get(b);

    return (ub.cpuPct + ub.memoryPct) - (ua.cpuPct + ua.memoryPct);
  });

  for (const src of sources) {
    let evicted = 0;
    const forcedRank = (p) => {
      const i = (opts.order || []).indexOf(`${ p?.metadata?.namespace }/${ p?.metadata?.name }`);

      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const others = nodes.filter((n) => n?.metadata?.name !== src);
    const candidates = pods
      .filter((p) => p?.spec?.nodeName === src && isActivePod(p) && isLauncher(p) && !(opts.excluded || []).includes(p?.metadata?.namespace))
    // nodeFit: a pod that no other node could take (selector, affinity, taints, cordon) is not evictable at all.
      .filter((p) => !opts.nodeFit || others.some((n) => podFitsNode(p, n)))
      .sort((a, b) => {
        const [pa, qa] = sortKey(a);
        const [pb, qb] = sortKey(b);

        // Among equals the real order is arbitrary; a replayed order only ever decides ties, never priority or QoS.
        return pa - pb || qa - qb || forcedRank(a) - forcedRank(b);
      });

    result.movable[src] = candidates.map((p) => vmName(p));
    for (const p of candidates) {
      if (opts.maxPerNode && evicted >= opts.maxPerNode) {
        break;
      }
      if (!aboveTarget(src) || !roomLeft()) {
        break;
      }
      const req = podRequests(p);
      let dest = null;

      if (opts.nodeFit) {
        const free = (n) => {
          const u = usage.get(n);

          return { cpu: u.allocatable.cpu - u.requests.cpu, memory: u.allocatable.memory - u.requests.memory };
        };

        // Best guess for the scheduler's choice: the fitting node with the most free memory.
        dest = under
          .filter((n) => nodes.some((o) => o?.metadata?.name === n && podFitsNode(p, o)))
          .filter((n) => free(n).cpu >= req.cpu && free(n).memory >= req.memory)
          .sort((a, b) => free(b).memory - free(a).memory)[0] || null;
        if (!dest) {
          result.skipped.push({ vm: vmName(p), why: 'doesNotFit' });
          continue;
        }
      } else {
        dest = under.find((n) => bands(n) === 'under') || under[0];
      }
      const s = usage.get(src);
      const d = usage.get(dest);

      s.requests = { cpu: s.requests.cpu - req.cpu, memory: s.requests.memory - req.memory };
      d.requests = { cpu: d.requests.cpu + req.cpu, memory: d.requests.memory + req.memory };
      usage.set(src, recompute({ ...s, pods: s.pods - 1 }));
      usage.set(dest, recompute({ ...d, pods: d.pods + 1 }));
      total.cpu -= req.cpu;
      total.memory -= req.memory;
      evicted++;
      result.evictions.push({
        vm: vmName(p), pod: p.metadata?.name, namespace: p.metadata?.namespace, from: src, to: dest, requests: req
      });
    }
  }
  result.after = before.map((u) => usage.get(u.name));

  return result;
}
