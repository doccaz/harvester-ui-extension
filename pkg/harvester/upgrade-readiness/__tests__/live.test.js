import lab from './fixtures/lab-2026-11-06.json';
import mid from './fixtures/mid-upgrade.json';
import { jobLogCommand, liveStatus } from '../utils/live';

const clone = (o) => JSON.parse(JSON.stringify(o));

// The lab as if an upgrade to v1.9.0 were half-way (built by hack/make-live-preview.mjs in the project repo).
const midUpgrade = () => clone(mid);

describe('liveStatus', () => {
  it('is null when no upgrade is running (lab today)', () => {
    expect(liveStatus(lab)).toBeNull();
  });

  const live = liveStatus(midUpgrade());

  it('shows the running upgrade and its phases', () => {
    expect(live).toMatchObject({
      name: 'hvst-upgrade-new', state: 'UpgradingNodes', to: 'v1.9.0'
    });
    expect(live.phases.map((p) => `${ p.key }:${ p.status }`)).toStrictEqual([
      'ImageReady:done', 'RepoReady:done', 'NodesPrepared:done', 'SystemServicesUpgraded:done', 'NodesUpgraded:running', 'Completed:pending'
    ]);
  });

  it('says why each node is where it is', () => {
    expect(live.nodes['harvlab-witness'].why).toBe('done');
    expect(live.nodes.harv01lab).toMatchObject({
      why: 'preDraining', rancherDraining: true, migrations: ['labs/downstream-02 → harv02lab']
    });
    expect(live.nodes.harv01lab.job.name).toBe('hvst-upgrade-new-pre-drain-harv01lab');
    expect(live.nodes.harv02lab).toMatchObject({ why: 'paused', message: 'Node upgrade paused as requested by the user' });
  });

  it('tells "waiting for its turn" from "Rancher is draining it"', () => {
    const s = midUpgrade();
    const u = s.upgrades.find((x) => x.metadata.name === 'hvst-upgrade-new');

    u.status.nodeStatuses.harv01lab = { state: 'Images preloaded' };
    u.status.nodeStatuses.harv02lab = { state: 'Images preloaded' };
    const l = liveStatus(s);

    expect(l.nodes.harv01lab.why).toBe('rancherDraining');
    expect(l.nodes.harv02lab.why).toBe('waitingTurn');
  });

  it('gives the command to read a job log', () => {
    expect(jobLogCommand({ name: 'j1' })).toBe('kubectl -n harvester-system logs job/j1 --all-containers');
  });
});
