import yamlLib from '../utils/yamllib';
import { buildDryRun, buildPolicyYaml, parseDryRunFailure, parseDryRunLog } from '../utils/dryrun';
import { parseYaml } from '../utils/policy';
const RAW = `apiVersion: "descheduler/v1alpha2"
kind: "DeschedulerPolicy"
maxNoOfPodsToEvictPerNode: 5
profiles:
  - name: default
    pluginConfig:
      - name: DefaultEvictor
        args:
          nodeFit: true
      - name: LowNodeUtilization
        args:
          thresholds: { cpu: 30, memory: 30 }
          targetThresholds: { cpu: 50, memory: 50 }
          evictableNamespaces:
            exclude: [kube-system]
    plugins:
      balance:
        enabled: [LowNodeUtilization]
`;
const F = {
  lowCpu: 40, lowMem: 40, targetCpu: 60, targetMem: 85, maxPerNode: 2, nodeFit: false
};

describe('buildPolicyYaml', () => {
  it('changes only the simulator values and keeps the rest', () => {
    const out = parseYaml(buildPolicyYaml(RAW, F), yamlLib);
    const lno = out.profiles[0].pluginConfig[1].args;

    expect(lno.thresholds).toStrictEqual({ cpu: 40, memory: 40 });
    expect(lno.targetThresholds).toStrictEqual({ cpu: 60, memory: 85 });
    expect(lno.evictableNamespaces.exclude).toStrictEqual(['kube-system']);
    expect(out.maxNoOfPodsToEvictPerNode).toBe(2);
    expect(out.profiles[0].pluginConfig[0].args.nodeFit).toBe(false);
    expect(out.profiles[0].plugins.balance.enabled).toStrictEqual(['LowNodeUtilization']);
  });
  it('drops the per-node cap when unlimited and refuses a policy without the plugin', () => {
    expect(parseYaml(buildPolicyYaml(RAW, { ...F, maxPerNode: 0 }), yamlLib).maxNoOfPodsToEvictPerNode).toBeUndefined();
    expect(() => buildPolicyYaml('profiles: []', F)).toThrow(/not configured/);
  });
});
describe('buildDryRun', () => {
  const container = {
    image:           'registry.k8s.io/descheduler/descheduler:v0.33.0',
    command:         ['/bin/descheduler'],
    args:            ['--policy-config-file=/policy-dir/policy.yaml', '--descheduling-interval=5m', '--feature-gates=EvictionsInBackground=true', '--v=3'],
    securityContext: { runAsNonRoot: true, runAsUser: 1000 }
  };
  const d = buildDryRun(buildPolicyYaml(RAW, F), container, 'descheduler', new Date('2026-11-04T18:30:05Z'));
  const c = d.job.spec.template.spec.containers[0];
  const cm = d.configMap('job-uid');

  it('names the Job and ConfigMap uniquely and mounts the policy', () => {
    expect(d.name).toBe('descheduler-dry-run-20261104183005');
    expect(d.job.spec.template.spec.volumes[0].configMap.name).toBe(d.name);
    expect(cm.metadata.name).toBe(d.name);
  });
  it('reuses the add-on container but runs one dry-run cycle', () => {
    expect(c.image).toBe(container.image);
    expect(c.securityContext).toStrictEqual(container.securityContext);
    expect(c.args).toStrictEqual(['--policy-config-file=/policy-dir/policy.yaml', '--dry-run', '--feature-gates=EvictionsInBackground=true', '--v=3']);
    expect(d.job.spec.template.metadata.labels['app.kubernetes.io/name']).toBe('descheduler-dry-run');
  });
  it('makes the ConfigMap owned by the Job so the TTL cleanup removes both', () => {
    expect(cm.metadata.ownerReferences).toStrictEqual([{
      apiVersion: 'batch/v1', kind: 'Job', name: d.name, uid: 'job-uid'
    }]);
    expect(parseYaml(cm.data['policy.yaml'], yamlLib).maxNoOfPodsToEvictPerNode).toBe(2);
    expect(d.job.spec.ttlSecondsAfterFinished).toBe(3600);
  });
  it('refuses to build without an image', () => {
    expect(() => buildDryRun('x', {})).toThrow('image');
  });
});
describe('parseDryRunLog', () => {
  const log = [
    'I1104 18:30:07.1       1 evictions.go:200] "Evicted pod in dry run mode" pod="labs/virt-launcher-a-1" reason="" strategy="LowNodeUtilization" node="harv02lab" profile="default"',
    'I1104 18:30:07.2       1 profile.go:376] "Total number of evictions/requests" evictedPods=1 evictionRequests=0',
    'I1104 18:30:07.3       1 evictions.go:200] "Evicted pod in dry run mode" pod="labs/virt-launcher-b-2" reason="" strategy="LowNodeUtilization" node="harv02lab" profile="default"'
  ].join('\n');

  it('extracts pod, strategy and node', () => {
    expect(parseDryRunLog(log)).toStrictEqual([
      {
        pod: 'labs/virt-launcher-a-1', strategy: 'LowNodeUtilization', node: 'harv02lab'
      },
      {
        pod: 'labs/virt-launcher-b-2', strategy: 'LowNodeUtilization', node: 'harv02lab'
      }
    ]);
    expect(parseDryRunLog('')).toStrictEqual([]);
  });
});
describe('invalid policies', () => {
  it('refuses to build a policy whose low threshold is above its target', () => {
    expect(() => buildPolicyYaml(RAW, { ...F, lowCpu: 70 })).toThrow(/above its target/);
  });
  it('extracts the descheduler failure from its log', () => {
    const log = `E1104 18:59:31.689375       1 server.go:73] "failed to run descheduler server" err="in profile default: thresholds' cpu percentage is greater than targetThresholds'"`;

    expect(parseDryRunFailure(log)).toBe("in profile default: thresholds' cpu percentage is greater than targetThresholds'");
    expect(parseDryRunFailure('all fine')).toBeUndefined();
  });
});
describe('excluded namespaces in the dry-run policy', () => {
  it('replaces the exclude list when given, leaves it alone otherwise', () => {
    const withList = parseYaml(buildPolicyYaml(RAW, { ...F, excluded: ['labs', 'kube-system'] }), yamlLib).profiles[0].pluginConfig[1].args;

    expect(withList.evictableNamespaces.exclude).toStrictEqual(['labs', 'kube-system']);
    expect(parseYaml(buildPolicyYaml(RAW, F), yamlLib).profiles[0].pluginConfig[1].args.evictableNamespaces.exclude).toStrictEqual(['kube-system']);
  });
  it('drops the block when the list is emptied', () => {
    expect(parseYaml(buildPolicyYaml(RAW, { ...F, excluded: [] }), yamlLib).profiles[0].pluginConfig[1].args.evictableNamespaces).toBeUndefined();
  });
});
