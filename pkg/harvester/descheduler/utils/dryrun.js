import yaml from './yamllib';
import { parseYaml } from './policy';
import { thresholdsValid } from './simulate';
/**
 * Dry run: the actual descheduler binary, run once with `--dry-run` against the policy from the Simulator. In dry-run mode the
 * descheduler simulates evictions in memory and evicts nothing. Without --descheduling-interval it runs one cycle and exits.
 *
 * The run is a Job (plus a ConfigMap with the policy, owned by the Job) in kube-system, using the add-on's own image, command,
 * ServiceAccount and security context, so it behaves like the running descheduler. Kubernetes deletes both one hour after the
 * Job finishes.
 */
export const DRYRUN_LABEL = 'descheduler-dry-run';
/** The live policy with only the simulator values changed (everything else, e.g. excluded namespaces, stays as is). */
export function buildPolicyYaml(policyRaw, f, lib = yaml) {
  const policy = parseYaml(policyRaw, lib);
  let found = false;

  if (!thresholdsValid({ thresholds: { cpu: f.lowCpu, memory: f.lowMem }, targetThresholds: { cpu: f.targetCpu, memory: f.targetMem } })) {
    throw new Error('A low threshold is above its target threshold; the descheduler would refuse to start');
  }
  if (f.maxPerNode) {
    policy.maxNoOfPodsToEvictPerNode = f.maxPerNode;
  } else {
    delete policy.maxNoOfPodsToEvictPerNode;
  }
  for (const prof of policy.profiles || []) {
    for (const pc of prof.pluginConfig || []) {
      if (pc.name === 'LowNodeUtilization') {
        found = true;
        pc.args = pc.args || {};
        pc.args.thresholds = {
          ...pc.args.thresholds, cpu: f.lowCpu, memory: f.lowMem
        };
        pc.args.targetThresholds = {
          ...pc.args.targetThresholds, cpu: f.targetCpu, memory: f.targetMem
        };
        if (f.excluded !== undefined) {
          const ns = { ...(pc.args.evictableNamespaces || {}) };

          if ((ns.include || []).length && f.excluded.length) {
            throw new Error('The policy uses an include list for namespaces; excluded namespaces cannot be edited here');
          }
          if (f.excluded.length) {
            ns.exclude = f.excluded;
          } else {
            delete ns.exclude;
          }
          if (Object.keys(ns).length) {
            pc.args.evictableNamespaces = ns;
          } else {
            delete pc.args.evictableNamespaces;
          }
        }
      }
      if (pc.name === 'DefaultEvictor') {
        pc.args = { ...pc.args, nodeFit: f.nodeFit };
      }
    }
  }
  if (!found) {
    throw new Error('LowNodeUtilization is not configured in the active policy');
  }

  return lib.dump(policy);
}
const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const TTL_SECONDS = 3600;
// Flags of the running descheduler that a one-shot dry run must not inherit.
const DROP_ARGS = /^--(policy-config-file|descheduling-interval|dry-run)(=|$)/;

/**
 * The Job and its ConfigMap. `container` is the add-on Deployment's descheduler container: the dry run reuses its image, command,
 * flags (feature gates, verbosity) and security context.
 */
export function buildDryRun(policyYaml, container, serviceAccountName = 'descheduler', now = new Date()) {
  if (!container?.image) {
    throw new Error('The descheduler image could not be read from the add-on Deployment');
  }
  const name = `descheduler-dry-run-${ stamp(now) }`;
  const labels = { 'app.kubernetes.io/name': DRYRUN_LABEL };
  const args = (container.args || []).filter((a) => !DROP_ARGS.test(a));
  const job = {
    apiVersion: 'batch/v1',
    kind:       'Job',
    metadata:   {
      name, namespace: 'kube-system', labels
    },
    spec: {
      backoffLimit:            0,
      ttlSecondsAfterFinished: TTL_SECONDS,
      template:                {
        metadata: { labels },
        spec:     {
          restartPolicy:      'Never',
          serviceAccountName,
          containers:         [{
            name:            'descheduler',
            image:           container.image,
            command:         container.command || ['/bin/descheduler'],
            args:            ['--policy-config-file=/policy-dir/policy.yaml', '--dry-run', ...args],
            resources:       { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
            securityContext: container.securityContext || {
              allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, readOnlyRootFilesystem: true, runAsNonRoot: true
            },
            volumeMounts: [{ name: 'policy-volume', mountPath: '/policy-dir' }]
          }],
          volumes: [{ name: 'policy-volume', configMap: { name } }]
        }
      }
    }
  };
  // Owned by the Job so that the TTL controller's deletion of the Job also removes it.
  const configMap = (jobUid) => ({
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      name,
      namespace:       'kube-system',
      labels,
      ownerReferences: [{
        apiVersion: 'batch/v1', kind: 'Job', name, uid: jobUid
      }]
    },
    data: { 'policy.yaml': policyYaml }
  });

  return {
    name, job, configMap
  };
}
const EVICTED = /"Evicted pod in dry run mode" pod="([^"]+)"(?:.*?strategy="([^"]*)")?.*?node="([^"]*)"/;

export function parseDryRunLog(log) {
  const out = [];

  for (const line of (log || '').split('\n')) {
    const m = EVICTED.exec(line);

    if (m) {
      out.push({
        pod: m[1], strategy: m[2], node: m[3]
      });
    }
  }

  return out;
}
/** Why a finished dry run produced no result: the descheduler's own error, e.g. a rejected policy. */
export function parseDryRunFailure(log) {
  const m = /"failed to run descheduler server" err="([^"]*)"/.exec(log || '');

  return m ? m[1] : undefined;
}
