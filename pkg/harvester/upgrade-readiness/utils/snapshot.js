import { TRIM, trimKubelet } from './trim';
import { K8S, SOURCES } from './sources';
import { apiPath, describeLive, objKey, patchPaths } from './drift';

/**
 * Loads everything the checks need, with the user's session (GETs only), and trims it.
 * A failed source is recorded in `errors` (e.g. 403 for a non-admin) so only the checks using it become "unknown".
 */
export const SERVING_CERT_ID = 'kube-system/rke2-serving';

const errText = (e) => `${ e?._status || e?.status || e?.response?.status || '' } ${ e?.message || e?._statusText || '' }`.trim() || String(e);

/**
 * @param request   `clusterRequest(store)`
 * @param certNotAfter async () => ISO date of the serving cert, or throws (the page uses the shell's Secret model, which parses X.509)
 */
export async function loadSnapshot(request, certNotAfter) {
  const snap = { errors: {}, loadedAt: new Date().toISOString() };

  await Promise.all(Object.entries(SOURCES).map(async([key, url]) => {
    try {
      snap[key] = TRIM[key](await request({ url }));
    } catch (e) {
      snap.errors[key] = errText(e);
    }
  }));

  snap.kubelet = {};
  if (snap.nodes) {
    const failures = [];

    await Promise.all(snap.nodes.map(async(n) => {
      const name = n.metadata.name;

      try {
        const [summary, configz] = await Promise.all([
          request({ url: `${ K8S }/api/v1/nodes/${ name }/proxy/stats/summary` }),
          request({ url: `${ K8S }/api/v1/nodes/${ name }/proxy/configz` })
        ]);

        snap.kubelet[name] = trimKubelet(summary, configz);
      } catch (e) {
        failures.push(`${ name }: ${ errText(e) }`);
      }
    }));
    if (failures.length === snap.nodes.length) {
      snap.errors.kubelet = failures.join('; ');
    }
  } else {
    snap.errors.kubelet = 'nodes not readable';
  }

  if (snap.managedCharts?.some((m) => m.status.ready && m.status.ready.status !== 'True')) {
    snap.drift = await loadDrift(request, snap);
  }

  try {
    snap.certNotAfter = await certNotAfter();
    if (!snap.certNotAfter) {
      throw new Error('no certificate');
    }
  } catch (e) {
    snap.errors.certNotAfter = errText(e);
  }

  return snap;
}

const DEFAULT_API = {
  Deployment: 'apps/v1', DaemonSet: 'apps/v1', StatefulSet: 'apps/v1', ReplicaSet: 'apps/v1', Job: 'batch/v1'
};

/**
 * Only when a ManagedChart is not ready: the live objects its BundleDeployment names (owner, readiness, patched fields),
 * the RKE2 Addons (to name a manifest file) and the fleet-agent log of the last 2 h (to tell when Fleet last tried).
 */
async function loadDrift(request, snap) {
  const drift = {
    live: {}, k3sAddons: [], fleetLog: '', errors: {}
  };
  const bad = snap.managedCharts.filter((m) => m.status.ready && m.status.ready.status !== 'True').map((m) => `mcc-${ m.metadata.name }`);
  const bds = (snap.bundleDeployments || []).filter((b) => bad.includes(b.metadata.name));
  const objects = new Map();

  bds.forEach((b) => {
    (b.status.modifiedStatus || []).forEach((m) => objects.set(objKey(m), { ...m, paths: m.patch ? safePaths(m.patch) : [] }));
    (b.status.nonReadyStatus || []).forEach((n) => objects.has(objKey(n)) || objects.set(objKey(n), {
      ...n, apiVersion: n.apiVersion || DEFAULT_API[n.kind], paths: []
    }));
  });

  await Promise.all([...objects.values()].map(async(o) => {
    try {
      drift.live[objKey(o)] = describeLive(await request({ url: `${ K8S }${ apiPath(o) }` }), o.paths);
    } catch (e) {
      drift.live[objKey(o)] = (e?._status || e?.status) === 404 ? { exists: false } : { exists: undefined, error: errText(e) };
    }
  }));

  try {
    drift.k3sAddons = TRIM.k3sAddons(await request({ url: `${ K8S }/apis/k3s.cattle.io/v1/addons` }));
  } catch (e) {
    drift.errors.k3sAddons = errText(e);
  }

  try {
    const pods = (await request({ url: `${ K8S }/api/v1/namespaces/cattle-fleet-local-system/pods` }))?.items || [];
    const agent = pods.find((p) => p.metadata.name.startsWith('fleet-agent-') && p.status?.phase === 'Running');

    if (agent) {
      const r = await request({ url: `${ K8S }/api/v1/namespaces/cattle-fleet-local-system/pods/${ agent.metadata.name }/log?sinceSeconds=7200` });

      drift.fleetLog = typeof r === 'string' ? r : (r?.data || '');
    }
  } catch (e) {
    drift.errors.fleetLog = errText(e);
  }

  return drift;
}

function safePaths(patch) {
  try {
    return patchPaths(JSON.parse(patch));
  } catch (e) {
    return [];
  }
}
