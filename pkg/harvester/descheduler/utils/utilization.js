import { cpuMillis, memBytes } from './quantity';
const ZERO = () => ({ cpu: 0, memory: 0 });
const add = (a, b) => ({ cpu: a.cpu + b.cpu, memory: a.memory + b.memory });
const max = (a, b) => ({ cpu: Math.max(a.cpu, b.cpu), memory: Math.max(a.memory, b.memory) });

function containerRequests(c) {
  return { cpu: cpuMillis(c?.resources?.requests?.cpu), memory: memBytes(c?.resources?.requests?.memory) };
}
/**
 * Pod requests as the descheduler 0.33 computes them: the sum of the app containers, raised to the largest single
 * init container if that is bigger, plus pod overhead.
 *
 * Deliberately NOT the modern Kubernetes rule: restartable init containers (sidecars, `restartPolicy: Always`) are NOT
 * added to the running total. Verified on the lab 2026-11-04: every virt-launcher pod has a sidecar requesting 5m / 35M,
 * and the descheduler's logged usage was lower than the sum-with-sidecars by exactly (number of virt-launcher pods on
 * the node) x (5m, 35M): harv01lab 5 pods = 25m / 175M, harv02lab 4 pods = 20m / 140M. The goal is to predict what the
 * descheduler decides, so we mirror it.
 */
export function podRequests(pod) {
  let total = ZERO();

  for (const c of pod?.spec?.containers || []) {
    total = add(total, containerRequests(c));
  }
  let initMax = ZERO();

  for (const ic of pod?.spec?.initContainers || []) {
    initMax = max(initMax, containerRequests(ic));
  }
  const overhead = { cpu: cpuMillis(pod?.spec?.overhead?.cpu), memory: memBytes(pod?.spec?.overhead?.memory) };

  return add(max(total, initMax), overhead);
}
/** Pods that still hold their requests on a node. */
export function isActivePod(pod) {
  const phase = pod?.status?.phase;

  return phase !== 'Succeeded' && phase !== 'Failed';
}
/**
 * Exact percentage. Not rounded: the descheduler compares the raw ratio, so a node at 29.6% is underutilized against a 30%
 * threshold. Round only for display (see `formatPct`).
 */
export const percent = (used, of) => (of > 0 ? (used / of) * 100 : 0);

export function nodeUsage(node, pods) {
  const name = node?.metadata?.name;
  const allocatable = { cpu: cpuMillis(node?.status?.allocatable?.cpu), memory: memBytes(node?.status?.allocatable?.memory) };
  const mine = pods.filter((p) => p?.spec?.nodeName === name && isActivePod(p));
  const requests = mine.reduce((acc, p) => add(acc, podRequests(p)), ZERO());

  return {
    name,
    allocatable,
    requests,
    pods:      mine.length,
    cpuPct:    percent(requests.cpu, allocatable.cpu),
    memoryPct: percent(requests.memory, allocatable.memory)
  };
}
/**
 * LowNodeUtilization semantics (absolute thresholds): a node is underutilized only if EVERY configured
 * resource is below its threshold, overutilized if ANY configured resource is above its target.
 * Only resources named in `thresholds` count. Deviation mode is not modelled yet.
 */
export function classify(u, t) {
  const get = (r) => (r === 'cpu' ? u.cpuPct : u.memoryPct);
  const resources = ['cpu', 'memory'].filter((r) => t.thresholds[r] !== undefined);

  if (resources.some((r) => t.targetThresholds[r] !== undefined && get(r) > t.targetThresholds[r])) {
    return 'over';
  }
  if (resources.length > 0 && resources.every((r) => get(r) < t.thresholds[r])) {
    return 'under';
  }

  return 'appropriate';
}
/** One-line answer to "will the descheduler move anything?" */
export function verdict(usages, t) {
  if (!t) {
    return {
      key: 'noPolicy', under: [], over: []
    };
  }
  // Deviation mode compares each node with the cluster average, not with absolute values; it is not modelled, so no prediction.
  if (t.useDeviationThresholds) {
    return {
      key: 'deviation', under: [], over: []
    };
  }
  const under = usages.filter((u) => classify(u, t) === 'under').map((u) => u.name);
  const over = usages.filter((u) => classify(u, t) === 'over').map((u) => u.name);

  if (t.numberOfNodes && under.length <= t.numberOfNodes && under.length > 0) {
    return {
      key: 'tooFewUnder', under, over
    };
  }
  if (under.length === 0) {
    return {
      key: 'noUnder', under, over
    };
  }
  if (over.length === 0) {
    return {
      key: 'noOver', under, over
    };
  }

  return {
    key: 'wouldAct', under, over
  };
}
