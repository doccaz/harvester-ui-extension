import lab from './fixtures/lab-2026-11-06.json';
import {
  compareVersions, deviceName, isoVersion, matchesTerms, pvcToVm, runChecks, verdict
} from '../utils/checks';

const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));

describe('pre-flight checks on the lab snapshot (2026-11-06, after the kube-vip fix)', () => {
  const r = byId(runChecks(lab));

  it('matches hack/preflight.py: single-replica and GPU VM block, the rest passes', () => {
    expect(verdict(Object.values(r))).toStrictEqual({
      block: 2, warn: 0, unknown: 0, pass: 14, skip: 0
    });
    expect(r.singleReplica.status).toBe('block');
    expect(r.nonMigratable.status).toBe('block');
    expect(r.managedCharts.status).toBe('pass');
  });

  it('names single-replica volumes by VM, attached first, and offers the skip option for detached ones', () => {
    const { items, args, fixes } = r.singleReplica;

    expect(args).toStrictEqual({ attached: 3, detached: 3 });
    expect(items.filter((i) => i.attached).map((i) => i.text).sort()).toStrictEqual(['labs/downstream-01', 'labs/sles16-01', 'labs/smlm-prod']);
    expect(fixes.map((f) => f.labelKey)).toContain('optionSkipDetached');
  });

  it('shows where the only good copy lives and flags the stuck extra replica', () => {
    const ds = r.singleReplica.items.find((i) => i.text === 'labs/downstream-01');

    expect(ds.replicaNodes).toStrictEqual(['harv02lab']);
    expect(ds.stuckReplicaNodes).toStrictEqual(['harv01lab']);
    expect(ds.stuckReplicas).toStrictEqual([{
      name: 'pvc-534bc17f-8aaa-49b7-8d9b-f414b3150b50-r-8208dd79', node: 'harv01lab', retries: 5
    }]);
    expect(ds.volume).toBe('pvc-534bc17f-8aaa-49b7-8d9b-f414b3150b50');
  });

  it('does not call the only replica of a never-attached volume stuck', () => {
    const cor = r.singleReplica.items.find((i) => i.text.includes('coriolis-replica-sles16-0'));

    expect(cor.stuckReplicaNodes).toStrictEqual([]);
    expect(cor.unusedReplicaNodes).toStrictEqual(['harv02lab']);
  });

  it('finds the uploaded v1.9.0 ISO as the upgrade source and links to the image upgrade page', () => {
    expect(r.versionAvailable.status).toBe('pass');
    expect(r.versionAvailable.okKey).toBe('okIso');
    expect(r.versionAvailable.args).toMatchObject({ current: 'v1.8.2', iso: 'harvester-v1.9.0-amd64.iso' });
    expect(r.versionAvailable.extraFixes[0].to).toStrictEqual({ routeName: 'airgapupgrade' });
  });

  it('without a Version or a newer ISO, warns and offers the checker settings and the dashboard', () => {
    const s = clone(lab);

    s.images = s.images.filter((i) => !i.spec.displayName.includes('v1.9'));
    const v = byId(runChecks(s)).versionAvailable;

    expect(v.status).toBe('warn');
    expect(v.args).toStrictEqual({
      count: 0, current: 'v1.8.2', checker: 'on', iso: ''
    });
    expect(v.fixes.map((f) => f.to.id || f.to.resource)).toStrictEqual(['upgrade-checker-enabled', 'upgrade-checker-url', 'harvesterhci.io.dashboard']);
  });

  it('explains why gpu-node cannot migrate', () => {
    expect(r.nonMigratable.items).toHaveLength(1);
    expect(r.nonMigratable.items[0].text).toBe('labs/gpu-node');
    expect(r.nonMigratable.items[0].reason).toBe('device');
    expect(r.nonMigratable.items[0].reasonArgs.devices).toBe('GB205 GEFORCE RTX 5070, GB205 HIGH DEFINITION AUDIO CONTROLLER');
  });

  it('computes disk space like the webhook (+13 GiB vs the GC threshold)', () => {
    expect(r.diskSpace.status).toBe('pass');
    expect(r.diskSpace.items.map((i) => i.text).sort()).toStrictEqual(['harv01lab', 'harv02lab', 'harvlab-witness']);
  });

  it('checks the serving cert expiry', () => {
    expect(r.certExpiry.status).toBe('pass');
    expect(r.certExpiry.args.date).toBe('2027-04-30');
  });
});

describe('pre-flight checks on variations', () => {
  it('reports the blocked chart with Fleet\'s message and a retry-now command', () => {
    const s = clone(lab);

    s.managedCharts[0].status.ready = { status: 'False', message: 'ErrApplied(1) [...] spec.selector: ... field is immutable' };
    const c = byId(runChecks(s)).managedCharts;

    expect(c.status).toBe('block');
    expect(c.items[0].note).toContain('immutable');
    expect(c.fixes[0].command).toContain('rollout restart deploy/fleet-agent');
  });

  it('marks only the checks whose data could not be read as unknown', () => {
    const s = clone(lab);

    delete s.lhReplicas;
    s.errors = { lhReplicas: '403 forbidden' };
    const r = byId(runChecks(s));

    expect(r.singleReplica.status).toBe('unknown');
    expect(r.singleReplica.args.sources).toBe('lhReplicas');
    expect(r.nonMigratable.status).toBe('block');
  });

  it('skips the migration checks when restoreVM is on, like the webhook', () => {
    const s = clone(lab);

    s.upgradeConfig.value = JSON.stringify({ restoreVM: true });
    const r = byId(runChecks(s));

    expect(r.nonMigratable.status).toBe('skip');
    expect(r.hotplug.status).toBe('skip');
  });

  it('blocks on active schedules, cordoned nodes and a cert about to expire', () => {
    const s = clone(lab);

    s.schedules[0].status.suspended = false;
    s.nodes[0].spec.unschedulable = true;
    s.certNotAfter = new Date(s.now + 3 * 24 * 3600 * 1000).toISOString();
    const r = byId(runChecks(s));

    expect(r.schedulesActive.status).toBe('block');
    expect(r.nodesReady.items[0].note).toContain('cordoned');
    expect(r.certExpiry.status).toBe('block');
  });

  it('blocks when a node would cross the image GC threshold', () => {
    const s = clone(lab);
    const name = Object.keys(s.kubelet)[0];

    s.kubelet[name] = {
      usedBytes: 80 * 1024 ** 3, capacityBytes: 100 * 1024 ** 3, gcHigh: 85
    };
    const d = byId(runChecks(s)).diskSpace;

    expect(d.status).toBe('block');
    expect(d.items[0].text).toBe(name);
  });

  it('blocks while a VM backup is still running, but not for failed ones', () => {
    const s = clone(lab);

    s.vmBackups[0].status = { error: null, readyToUse: false };
    s.vmBackups[1].status = { error: { message: 'boom' }, readyToUse: false };
    const b = byId(runChecks(s)).vmBackupsRunning;

    expect(b.status).toBe('block');
    expect(b.items).toHaveLength(1);
  });

  it('skips degraded-volume check below 3 nodes, as the webhook does', () => {
    const s = clone(lab);

    s.nodes = s.nodes.slice(0, 2);
    s.lhVolumes[0].status.robustness = 'degraded';
    expect(byId(runChecks(s)).longhornDegraded.status).toBe('skip');
  });
});

describe('helpers', () => {
  it('maps PVCs to VMs', () => {
    const vm = { metadata: { namespace: 'a', name: 'vm1' }, spec: { volumes: [{ name: 'd', claim: 'pvc1' }] } };

    expect(pvcToVm([vm])['a/pvc1']).toBe(vm);
  });

  it('reads and compares Harvester versions', () => {
    expect(isoVersion('harvester-v1.9.0-amd64.iso')).toBe('v1.9.0');
    expect(isoVersion('harvester-v1.9.0-rc2-amd64.iso')).toBe('v1.9.0-rc2');
    expect(isoVersion('ubuntu.iso')).toBeNull();
    expect(compareVersions('v1.9.0', 'v1.8.2')).toBeGreaterThan(0);
    expect(compareVersions('v1.8.1', 'v1.8.2')).toBeLessThan(0);
    expect(compareVersions('v1.9.0-rc1', 'v1.9.0')).toBeLessThan(0);
    expect(compareVersions('v1.10.0', 'v1.9.0')).toBeGreaterThan(0);
  });

  it('makes device plugin names readable', () => {
    expect(deviceName('nvidia.com/GB205_GEFORCE_RTX_5070')).toBe('GB205 GEFORCE RTX 5070');
  });

  it('explains node-selector and affinity pins', () => {
    const s = clone(lab);
    const [a, b] = s.vmis.filter((i) => !i.spec.hostDevices);

    a.spec.nodeSelector = { 'kubernetes.io/hostname': 'harv01lab' };
    b.spec.affinity = {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{
            matchFields: [{
              key: 'metadata.name', operator: 'In', values: [b.status.nodeName]
            }]
          }]
        }
      }
    };
    const reasons = byId(runChecks(s)).nonMigratable.items.map((i) => i.reason).sort();

    expect(reasons).toStrictEqual(['affinity', 'device', 'nodeSelector']);
  });

  it('matches node affinity terms', () => {
    const node = { metadata: { name: 'n1', labels: { gpu: 'yes' } } };

    expect(matchesTerms(node, {
      nodeSelectorTerms: [{
        matchExpressions: [{
          key: 'gpu', operator: 'In', values: ['yes']
        }]
      }]
    })).toBe(true);
    expect(matchesTerms(node, { nodeSelectorTerms: [{ matchExpressions: [{ key: 'gpu', operator: 'DoesNotExist' }] }] })).toBe(false);
    expect(matchesTerms(node, {
      nodeSelectorTerms: [{
        matchFields: [{
          key: 'metadata.name', operator: 'In', values: ['n2']
        }]
      }]
    })).toBe(false);
  });
});
