/**
 * Explains why a ManagedChart is not ready ("managed chart harvester is not ready"), from what Fleet already records:
 * the chart's BundleDeployment `status.modifiedStatus` / `nonReadyStatus` / conditions, plus the live objects they name.
 * Pure and import-free (the fixture generator imports it directly). Never writes; fixes are commands for the user.
 *
 * Row types:
 *   notOwned  the object exists but belongs to something else (Fleet's `exist`), so Fleet cannot update it
 *   patch     fields differ from the chart (Fleet's `patch`)
 *   missing   Fleet wants to create it
 *   extra     Fleet would delete it
 *   notReady  the object exists but is not ready (re-checked live: may be stale)
 */

// ---------------------------------------------------------------------------------------------------------------- paths

/** Kubernetes API path of an object (plural guessed the way kubectl does for the kinds charts ship). */
export function apiPath({
  apiVersion, kind, namespace, name
}) {
  const lower = String(kind || '').toLowerCase();
  const plural = /(s|x|ch|sh)$/.test(lower) ? `${ lower }es` : (/[^aeiou]y$/.test(lower) ? `${ lower.slice(0, -1) }ies` : `${ lower }s`);
  const base = String(apiVersion || 'v1').includes('/') ? `/apis/${ apiVersion }` : `/api/${ apiVersion || 'v1' }`;

  return `${ base }${ namespace ? `/namespaces/${ namespace }` : '' }/${ plural }/${ name }`;
}

export const objKey = (o) => `${ o.kind }/${ o.namespace || '' }/${ o.name }`;

/** Merge patch -> leaf paths with the value the chart wants: {"spec":{"a":{"b":[]}}} -> [{ path: ['spec','a','b'], want: [] }]. */
export function patchPaths(patch, prefix = []) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return [{ path: prefix, want: patch }];
  }

  return Object.entries(patch).flatMap(([k, v]) => patchPaths(v, [...prefix, k]));
}

const at = (obj, path) => path.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

/** Field managers that own `path` (from managedFields), newest first: who changed it, and when. */
export function managersOf(obj, path) {
  return (obj?.metadata?.managedFields || []).filter((m) => {
    let node = m.fieldsV1;

    for (const seg of path) {
      node = node?.[`f:${ seg }`];
      if (node === undefined) {
        return false;
      }
    }

    return true;
  }).map((m) => ({
    manager: m.manager, operation: m.operation, time: m.time || null
  }))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

// ------------------------------------------------------------------------------------------------------ live summaries

/** Who owns an object, from the annotations the usual managers leave behind. */
export function ownerOf(obj) {
  const a = obj?.metadata?.annotations || {};
  const gvk = a['objectset.rio.cattle.io/owner-gvk'] || '';

  if (gvk.startsWith('k3s.cattle.io/') && gvk.endsWith('Kind=Addon')) {
    return {
      type: 'rke2Manifest', addon: a['objectset.rio.cattle.io/owner-name'], addonNamespace: a['objectset.rio.cattle.io/owner-namespace'] || 'kube-system'
    };
  }
  if (a['meta.helm.sh/release-name']) {
    return {
      type: 'helm', release: a['meta.helm.sh/release-name'], releaseNamespace: a['meta.helm.sh/release-namespace'] || ''
    };
  }
  if (a['objectset.rio.cattle.io/id']?.startsWith('default-') || (obj?.metadata?.labels?.['objectset.rio.cattle.io/hash'] && gvk.includes('fleet'))) {
    return { type: 'fleet', id: a['objectset.rio.cattle.io/id'] };
  }
  if (gvk) {
    return {
      type: 'objectset', gvk, name: a['objectset.rio.cattle.io/owner-name'] || ''
    };
  }

  return { type: 'unknown' };
}

/** Ready now? For the workload kinds Fleet reports; `null` when we cannot tell. */
export function readyNow(obj) {
  if (!obj) {
    return null;
  }
  const s = obj.status || {};
  const want = obj.spec?.replicas ?? 1;

  switch (obj.kind) {
  case 'Deployment':
  case 'StatefulSet':
    return (s.availableReplicas ?? s.readyReplicas ?? 0) >= want && (s.updatedReplicas ?? want) >= want;
  case 'DaemonSet':
    return (s.numberReady ?? 0) >= (s.desiredNumberScheduled ?? 0) && (s.numberUnavailable ?? 0) === 0;
  default:
    return null;
  }
}

/**
 * What the explainer keeps of a live object (small, no secrets): owner, readiness, the values at the patched paths and
 * who manages them. `paths` are the patch paths Fleet reported for this object.
 */
export function describeLive(obj, paths = []) {
  if (!obj) {
    return { exists: false };
  }

  return {
    exists: true,
    owner:  ownerOf(obj),
    ready:  readyNow(obj),
    fields: paths.map((p) => ({
      path: p.path.join('.'), have: at(obj, p.path), managers: managersOf(obj, p.path)
    }))
  };
}

// ----------------------------------------------------------------------------------------------------- fleet messages

/** Errors in a Fleet condition message, e.g. `cannot patch "kube-vip" with kind DaemonSet: ... field is immutable`. */
export function fleetErrors(message) {
  const out = [];
  const re = /cannot (patch|create|delete|update) "([^"]+)" with kind (\w+): ([^;\]]+)/g;
  let m;

  while ((m = re.exec(String(message || '')))) {
    out.push({
      verb: m[1], name: m[2], kind: m[3], text: m[4].trim(), immutable: /field is immutable/.test(m[4])
    });
  }

  return out;
}

/** Fleet's retries of one BundleDeployment, from fleet-agent log lines (JSON logs). */
export function fleetAttempts(logText, bdName) {
  return String(logText || '').split('\n').filter((l) => l.includes(`"${ bdName }"`)).map((l) => {
    try {
      const j = JSON.parse(l);

      return {
        ts: j.ts, msg: j.msg, error: j.error || ''
      };
    } catch (e) {
      return null;
    }
  })
    .filter((x) => x && /Upgrading helm release|Installing helm release|Deployed bundle|Reconciler error/.test(x.msg));
}

/** Last try, outcome and an estimate of the next one (median gap between tries in the log). */
export function freshness(attempts, now) {
  const starts = attempts.filter((a) => /Upgrading|Installing/.test(a.msg)).map((a) => Date.parse(a.ts)).filter(Number.isFinite);
  const last = attempts[attempts.length - 1] || null;

  if (!last) {
    return { known: false };
  }
  const gaps = starts.slice(1).map((t, i) => t - starts[i]).sort((a, b) => a - b);
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const lastStart = starts.length ? starts[starts.length - 1] : Date.parse(last.ts);

  return {
    known:     true,
    lastTry:   new Date(lastStart).toISOString(),
    outcome:   /Deployed bundle/.test(last.msg) ? 'deployed' : (/Reconciler error/.test(last.msg) ? 'failed' : 'running'),
    nextTry:   gap ? new Date(lastStart + gap).toISOString() : null,
    overdue:   gap ? now > lastStart + gap * 1.5 : false,
    intervalM: gap ? Math.round(gap / 60000) : null
  };
}

// ---------------------------------------------------------------------------------------------------------- explainer

/**
 * @param bd      trimmed BundleDeployment (status.modifiedStatus, nonReadyStatus, conditions)
 * @param live    { [objKey]: describeLive(...) }
 * @param addons  trimmed k3s Addons [{ metadata: { name, namespace }, spec: { source } }]
 */
export function explainChart(bd, live = {}, addons = []) {
  const st = bd?.status || {};
  const deployed = (st.conditions || []).find((c) => c.type === 'Deployed');
  const errors = fleetErrors(deployed?.status === 'False' ? deployed.message : '');
  const errorFor = (o) => errors.find((e) => e.name === o.name && e.kind === o.kind) || null;
  const rows = [];

  (st.modifiedStatus || []).forEach((m) => {
    const o = {
      apiVersion: m.apiVersion, kind: m.kind, namespace: m.namespace || '', name: m.name
    };
    const l = live[objKey(o)] || { exists: undefined };
    const base = { object: o, error: errorFor(o) };

    if (m.exist) {
      const owner = l.owner || { type: 'unknown' };
      const addon = owner.type === 'rke2Manifest' ? addons.find((a) => a.metadata.name === owner.addon && a.metadata.namespace === owner.addonNamespace) : null;

      rows.push({
        ...base, type: 'notOwned', owner: { ...owner, file: addon?.spec?.source || '' }
      });
    } else if (m.patch) {
      let wanted = [];

      try {
        wanted = patchPaths(JSON.parse(m.patch));
      } catch (e) {}
      const fields = wanted.map((w) => {
        const f = (l.fields || []).find((x) => x.path === w.path.join('.')) || {};

        return {
          path: w.path.join('.'), want: w.want, have: f.have, managers: f.managers || []
        };
      });

      // While Fleet cannot apply the chart at all, other differences may just be the part it never got to.
      rows.push({
        ...base, type: 'patch', fields, maybePending: errors.length > 0 && !base.error
      });
    } else if (m.missing) {
      rows.push({ ...base, type: 'missing' });
    } else if (m.delete) {
      rows.push({ ...base, type: 'extra' });
    }
  });

  (st.nonReadyStatus || []).forEach((n) => {
    const o = {
      apiVersion: n.apiVersion || '', kind: n.kind, namespace: n.namespace || '', name: n.name
    };
    const l = live[objKey(o)];

    rows.push({
      object: o, type: 'notReady', state: n.summary?.state || '', message: (n.summary?.message || []).join(', '), stale: l?.ready === true
    });
  });

  return { rows, errors };
}

// ------------------------------------------------------------------------------------------------------------- fixes

/** Copyable commands for one row (shown with a risk note; the page never runs them). */
export function fixCommands(row) {
  const o = row.object;
  const ref = `${ o.namespace ? `-n ${ o.namespace } ` : '' }${ o.kind.toLowerCase() } ${ o.name }`;

  if (row.type === 'notOwned' && row.owner?.type === 'rke2Manifest') {
    const file = row.owner.file || '/var/lib/rancher/rke2/server/manifests/<file>';

    return [
      { step: 'findFile', command: `ls -l ${ file }` },
      { step: 'parkFile', command: `sudo mkdir -p /var/lib/rancher/rke2/server/manifests-parked && sudo mv ${ file } /var/lib/rancher/rke2/server/manifests-parked/` },
      { step: 'deleteAddon', command: `kubectl -n ${ row.owner.addonNamespace } delete addons.k3s.cattle.io ${ row.owner.addon }` },
      { step: 'deleteObject', command: `kubectl delete ${ ref } --ignore-not-found` },
      { step: 'retryNow', command: 'kubectl -n cattle-fleet-local-system rollout restart deploy/fleet-agent' }
    ];
  }
  if (row.type === 'notOwned' || row.error?.immutable) {
    return [
      { step: 'inspect', command: `kubectl get ${ ref } -o yaml` },
      { step: 'deleteObject', command: `kubectl delete ${ ref }` },
      { step: 'retryNow', command: 'kubectl -n cattle-fleet-local-system rollout restart deploy/fleet-agent' }
    ];
  }
  if (row.type === 'patch') {
    return [{ step: 'inspect', command: `kubectl get ${ ref } -o yaml --show-managed-fields` }];
  }

  return [];
}
