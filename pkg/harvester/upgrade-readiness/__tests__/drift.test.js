import blocked from '../dev/drift-kubevip-blocked.json';
import {
  apiPath, describeLive, explainChart, fixCommands, fleetAttempts, fleetErrors, freshness, managersOf, ownerOf, patchPaths
} from '../utils/drift';

// Lab, 2026-11-06 16:27Z: a hand-made kube-vip DaemonSet from an RKE2 manifest file blocked the harvester chart.
const bd = blocked.bundleDeployments.find((b) => b.metadata.name === 'mcc-harvester');
const { rows, errors } = explainChart(bd, blocked.live, blocked.k3sAddons);
const row = (type) => rows.filter((r) => r.type === type);

describe('explainChart on the kube-vip blocked lab state', () => {
  it('finds the immutable-selector error Fleet hit', () => {
    expect(errors).toStrictEqual([{
      verb: 'patch', name: 'kube-vip', kind: 'DaemonSet', text: expect.stringContaining('spec.selector'), immutable: true
    }]);
  });

  it('says who really owns kube-vip: the RKE2 manifest file', () => {
    const [kv] = row('notOwned');

    expect(kv.object).toMatchObject({
      kind: 'DaemonSet', namespace: 'harvester-system', name: 'kube-vip'
    });
    expect(kv.owner).toStrictEqual({
      type: 'rke2Manifest', addon: 'kube-vip', addonNamespace: 'kube-system', file: '/var/lib/rancher/rke2/server/manifests/kube-vip.yaml'
    });
    expect(kv.error.immutable).toBe(true);
  });

  it('shows the KubeVirt field the chart wants back, and that it may just be pending', () => {
    const [kubevirt] = row('patch');

    expect(kubevirt.fields).toStrictEqual([{
      path: 'spec.workloadUpdateStrategy.workloadUpdateMethods', want: [], have: ['LiveMigrate'], managers: []
    }]);
    expect(kubevirt.maybePending).toBe(true);
  });

  it('flags the not-ready Deployments as stale (they were ready again)', () => {
    expect(row('notReady').map((r) => [r.object.name, r.stale])).toStrictEqual([
      ['harvester-network-controller-manager', true], ['harvester', true], ['harvester-webhook', true]
    ]);
  });

  it('gives the full fix sequence for an RKE2-manifest owner, in order', () => {
    expect(fixCommands(row('notOwned')[0]).map((c) => c.step)).toStrictEqual(['findFile', 'parkFile', 'deleteAddon', 'deleteObject', 'retryNow']);
    expect(fixCommands(row('notOwned')[0])[3].command).toBe('kubectl delete -n harvester-system daemonset kube-vip --ignore-not-found');
  });
});

describe('fleet freshness', () => {
  const line = (ts, msg, extra = {}) => JSON.stringify({
    level: 'info', ts, msg, BundleDeployment: { name: 'mcc-harvester', namespace: 'cluster-fleet-local-local-1a3d67d0a899' }, ...extra
  });
  const log = [
    line('2026-11-06T16:10:15Z', 'Upgrading helm release'),
    line('2026-11-06T16:10:30Z', 'Reconciler error', { error: 'failed deploying bundle: cannot patch "kube-vip" ...' }),
    line('2026-11-06T16:27:15Z', 'Upgrading helm release'),
    line('2026-11-06T16:27:29Z', 'Reconciler error', { error: 'failed deploying bundle' }),
    JSON.stringify({
      ts: '2026-11-06T16:28:00Z', msg: 'Upgrading helm release', BundleDeployment: { name: 'mcc-other' }
    })
  ].join('\n');

  it('reads the last try, its outcome and the next one from the agent log', () => {
    const f = freshness(fleetAttempts(log, 'mcc-harvester'), Date.parse('2026-11-06T16:33:00Z'));

    expect(f).toStrictEqual({
      known: true, lastTry: '2026-11-06T16:27:15.000Z', outcome: 'failed', nextTry: '2026-11-06T16:44:15.000Z', overdue: false, intervalM: 17
    });
  });

  it('says overdue when the next try is well past', () => {
    expect(freshness(fleetAttempts(log, 'mcc-harvester'), Date.parse('2026-11-06T17:10:00Z')).overdue).toBe(true);
  });

  it('knows nothing when the log has no tries (agent restarted, log rotated)', () => {
    expect(freshness(fleetAttempts('', 'mcc-harvester'), 0)).toStrictEqual({ known: false });
  });
});

describe('helpers', () => {
  it('builds API paths with the plural kubectl would use', () => {
    expect(apiPath({
      apiVersion: 'apps/v1', kind: 'DaemonSet', namespace: 'harvester-system', name: 'kube-vip'
    })).toBe('/apis/apps/v1/namespaces/harvester-system/daemonsets/kube-vip');
    expect(apiPath({
      apiVersion: 'kubevirt.io/v1', kind: 'KubeVirt', namespace: 'harvester-system', name: 'kubevirt'
    })).toBe('/apis/kubevirt.io/v1/namespaces/harvester-system/kubevirts/kubevirt');
    expect(apiPath({
      apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', name: 'x'
    })).toBe('/apis/networking.k8s.io/v1/networkpolicies/x');
    expect(apiPath({
      kind: 'Service', namespace: 'a', name: 'b'
    })).toBe('/api/v1/namespaces/a/services/b');
    expect(apiPath({
      apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', name: 'x'
    })).toBe('/apis/networking.k8s.io/v1/ingresses/x');
  });

  it('flattens a merge patch into leaf paths', () => {
    expect(patchPaths({ spec: { a: { b: [] }, c: 1 } })).toStrictEqual([{ path: ['spec', 'a', 'b'], want: [] }, { path: ['spec', 'c'], want: 1 }]);
  });

  it('finds who manages a field, newest first', () => {
    const obj = {
      metadata: {
        managedFields: [
          {
            manager: 'helm', operation: 'Update', time: '2026-09-01T00:00:00Z', fieldsV1: { 'f:spec': { 'f:x': {} } }
          },
          {
            manager: 'kubectl-edit', operation: 'Update', time: '2026-10-01T00:00:00Z', fieldsV1: { 'f:spec': { 'f:x': {} } }
          },
          {
            manager: 'other', operation: 'Update', time: '2026-11-01T00:00:00Z', fieldsV1: { 'f:spec': { 'f:y': {} } }
          }
        ]
      }
    };

    expect(managersOf(obj, ['spec', 'x']).map((m) => m.manager)).toStrictEqual(['kubectl-edit', 'helm']);
    expect(describeLive({ ...obj, spec: { x: 2 } }, [{ path: ['spec', 'x'], want: 1 }]).fields[0].have).toBe(2);
  });

  it('recognises owners', () => {
    expect(ownerOf({ metadata: { annotations: { 'meta.helm.sh/release-name': 'harvester', 'meta.helm.sh/release-namespace': 'harvester-system' } } }).type).toBe('helm');
    expect(ownerOf({ metadata: {} }).type).toBe('unknown');
  });

  it('parses several Fleet errors from one message', () => {
    const msg = 'ErrApplied(2) [Cluster x: cannot patch "a" with kind Service: boom; cannot create "b" with kind ConfigMap: exists]';

    expect(fleetErrors(msg).map((e) => `${ e.kind }/${ e.name }:${ e.immutable }`)).toStrictEqual(['Service/a:false', 'ConfigMap/b:false']);
  });
});
