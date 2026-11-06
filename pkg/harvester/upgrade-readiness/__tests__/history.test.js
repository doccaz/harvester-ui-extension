import lab from './fixtures/lab-2026-11-06.json';
import { historyRows, parseRepoInfo } from '../utils/history';

const rows = historyRows(lab.upgrades, lab.images);

describe('upgrade history on the lab records', () => {
  it('lists all five upgrades, newest first, with from -> to', () => {
    expect(rows.map((r) => `${ r.from }->${ r.to }`)).toStrictEqual([
      'v1.8.1->v1.8.2', 'v1.8.0->v1.8.1', 'v1.7.1->v1.8.0', 'v1.7.0->v1.7.1', 'v1.7.0-rc6->v1.7.0'
    ]);
    expect(rows.every((r) => r.result === 'succeeded')).toBe(true);
  });

  it('tells Version upgrades from ISO upgrades and names the ISO when it still exists', () => {
    expect(rows[0]).toMatchObject({
      source: 'version', iso: null, imageGone: false
    });
    expect(rows[1]).toMatchObject({
      source: 'iso', iso: 'harvester-v1.8.1-amd64.iso', imageGone: false
    });
    expect(rows[2]).toMatchObject({ source: 'iso', imageGone: true });
  });

  it('keeps nodes, contents and options', () => {
    expect(rows[0].nodes.map((n) => n.name)).toStrictEqual(['harv01lab', 'harv02lab', 'harvlab-witness']);
    expect(rows[1].components.rancher).toBe('v2.14.2');
    expect(rows[1].options.map((o) => o.key)).toContain('logging');
  });
});

describe('parseRepoInfo', () => {
  it('reads the release block', () => {
    expect(parseRepoInfo('release:\n  harvester: v1.8.1\n  kubernetes: v1.35.6+rke2r1\n  os: Harvester v1.8.1\n')).toStrictEqual({
      harvester: 'v1.8.1', kubernetes: 'v1.35.6+rke2r1', os: 'Harvester v1.8.1'
    });
  });

  it('reports pause maps, skip flags and failures', () => {
    const u = {
      metadata: {
        name: 'u', creationTimestamp: '2026-01-01T00:00:00Z', labels: { 'harvesterhci.io/upgradeState': 'Failed' }, annotations: { 'harvesterhci.io/node-upgrade-pause-map': '{"a":"pause"}', 'harvesterhci.io/skipSingleReplicaDetachedVol': 'true' }
      },
      spec:   {
        version: 'v1.9.0', image: '', logEnabled: false
      },
      status: {
        previousVersion: 'v1.8.2',
        repoInfo:        '',
        nodeStatuses:    {},
        conditions:      [{
          type: 'NodesUpgraded', status: 'False', message: 'drain timeout'
        }]
      }
    };
    const [r] = historyRows([u], []);

    expect(r.result).toBe('failed');
    expect(r.options.map((o) => o.key)).toStrictEqual(['pauseMap', 'skipDetached']);
    expect(r.failures).toStrictEqual([{ type: 'NodesUpgraded', text: 'drain timeout' }]);
  });
});
