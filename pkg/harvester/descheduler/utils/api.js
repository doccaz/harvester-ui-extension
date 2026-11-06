import {
  CONFIG_MAP, NAMESPACE, NODE, POD, WORKLOAD_TYPES
} from '@shell/config/types';
import { HCI } from '../../types';
import { clusterRequest } from './cluster';
import { activity, historyRows, parseCycles } from './history';
import { parseYaml, summarisePolicy } from './policy';
import { isActivePod } from './utilization';

/**
 * Data access. Nodes, pods, namespaces and migrations come from the dashboard store: the Harvester dashboard, host and VM lists
 * already load them, the store keeps them current over the websocket, and so opening a page costs nothing after the first visit.
 * Only pod logs and the dry-run Job go to the API directly.
 */
const NS = 'kube-system';
const NAME = 'descheduler';
const NAME_LABEL = 'app.kubernetes.io/name';

export const DESCHEDULER_ID = `${ NS }/${ NAME }`;

/** The store holding the current Harvester cluster: `harvester` standalone, the product's own store inside Rancher. */
export function storeName(store) {
  return store.getters['currentProduct']?.inStore || 'harvester';
}

export function findAll(store, type, force = false) {
  return store.dispatch(`${ storeName(store) }/findAll`, { type, opt: { force } });
}

async function findOrNull(store, type, id, force) {
  try {
    return await store.dispatch(`${ storeName(store) }/find`, {
      type, id, opt: { force }
    });
  } catch (e) {
    if (e?._status === 404 || e?.status === 404 || e?.code === 'NotFound') {
      return null;
    }
    throw e;
  }
}

export function loadNodes(store, force) {
  return findAll(store, NODE, force);
}

export function loadPods(store, force) {
  return findAll(store, POD, force);
}

export async function loadNamespaces(store) {
  return (await findAll(store, NAMESPACE)).map((n) => n?.metadata?.name).filter(Boolean);
}

export async function loadDescheduler(store, force) {
  const [addon, deployment, cm] = await Promise.all([
    findOrNull(store, HCI.ADD_ONS, DESCHEDULER_ID, force),
    findOrNull(store, WORKLOAD_TYPES.DEPLOYMENT, DESCHEDULER_ID, force),
    findOrNull(store, CONFIG_MAP, DESCHEDULER_ID, force)
  ]);
  const policyRaw = cm?.data?.['policy.yaml'] || null;
  let policy = null;
  let policyError = null;

  // A bad policy must not hide the add-on and deployment state.
  if (policyRaw) {
    try {
      policy = summarisePolicy(parseYaml(policyRaw));
    } catch (e) {
      policyError = e?.message || String(e);
    }
  }

  return {
    addon, deployment, policyRaw, policy, policyError
  };
}

/** The running descheduler pod, matched by label (a name prefix would also match the dry-run pods). */
export function deschedulerPod(pods) {
  return pods.find((p) => p?.metadata?.namespace === NS && p?.metadata?.labels?.[NAME_LABEL] === NAME && isActivePod(p));
}

export async function podLog(store, pod, params = '') {
  const r = await clusterRequest(store)({ url: `/k8s/clusters/local/api/v1/namespaces/${ pod.metadata.namespace }/pods/${ pod.metadata.name }/log${ params }` });

  return typeof r === 'string' ? r : (r?.data || '');
}

const HOUR = 3600000;

/**
 * Migrations (KubeVirt prunes old ones, so this is only the retained history) plus the descheduler's own log, which is
 * what lets us say whether a node evacuation was really a drain. The log is fetched from just before the oldest
 * migration (or the last 24 h when there are none), to keep the download small.
 */
export async function loadHistory(store, pods, force = false) {
  const vmims = await findAll(store, HCI.VMIM, force);
  const oldest = vmims.reduce((min, m) => Math.min(min, Date.parse(m.metadata?.creationTimestamp)), Date.now());
  const since = new Date(Math.min(oldest - HOUR, Date.now() - 24 * HOUR)).toISOString();
  const pod = deschedulerPod(pods);
  let cycles = [];
  let logError = null;

  if (!pod) {
    logError = 'descheduler pod not found';
  } else {
    try {
      cycles = parseCycles(await podLog(store, pod, `?sinceTime=${ encodeURIComponent(since) }`));
    } catch (e) {
      logError = e?.message || e?._statusText || String(e);
    }
  }

  return {
    rows: historyRows(vmims, cycles), activity: activity(cycles), logError
  };
}
