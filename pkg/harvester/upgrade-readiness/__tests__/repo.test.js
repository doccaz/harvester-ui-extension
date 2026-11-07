// The lab on 2026-11-07: an upgrade from an uploaded v1.9.0 ISO that was a `backingimage` image, stuck at "Repository"
// (repo pods Pending: persistentvolumeclaim "image-78wgm" not found), and the attempt before it, which failed because
// cleaning up the first attempt had deleted its ISO. Raw API lists, slimmed (see harvester-upgrade-control fixtures/).
import rawUpgrades from './fixtures/repo-stuck/upgrades.json';
import rawImages from './fixtures/repo-stuck/images.json';
import rawRepoPods from './fixtures/repo-stuck/repo-pods.json';
import lab from './fixtures/lab-2026-11-06.json';
import { TRIM } from '../utils/trim';
import { liveStatus } from '../utils/live';
import { runChecks } from '../utils/checks';
import { historyRows } from '../utils/history';

const clone = (o) => JSON.parse(JSON.stringify(o));
const snap = () => ({
  nodes:    [],
  upgrades: TRIM.upgrades(clone(rawUpgrades)),
  images:   TRIM.images(clone(rawImages)),
  repoPods: TRIM.repoPods(clone(rawRepoPods))
});
const PVC_MSG = '0/3 nodes are available: persistentvolumeclaim "image-78wgm" not found. not found';

describe('trimming', () => {
  it('keeps the image backend', () => {
    expect(TRIM.images(clone(rawImages)).find((i) => i.metadata.name === 'image-78wgm').spec).toMatchObject({ backend: 'backingimage', displayName: 'harvester-v1.9.0-amd64.iso' });
  });

  it('keeps why an unscheduled repo pod waits', () => {
    expect(TRIM.repoPods(clone(rawRepoPods))).toStrictEqual([
      expect.objectContaining({
        upgrade: 'hvst-upgrade-kflcl', phase: 'Pending', waitingOn: PVC_MSG
      }),
      expect.objectContaining({
        upgrade: 'hvst-upgrade-kflcl', phase: 'Pending', waitingOn: PVC_MSG
      })
    ]);
  });
});

describe('live view: Repository stuck', () => {
  it('says the ISO is not a cdi image, with the pod message as evidence', () => {
    const live = liveStatus(snap());

    expect(live.name).toBe('hvst-upgrade-kflcl');
    expect(live.repo).toStrictEqual({
      key: 'notCdi', image: 'harvester-v1.9.0-amd64.iso', backend: 'backingimage', waiting: [PVC_MSG]
    });
  });

  it('falls back to the pod message when the image is fine', () => {
    const s = snap();

    s.images.find((i) => i.metadata.name === 'image-78wgm').spec.backend = 'cdi';
    expect(liveStatus(s).repo).toMatchObject({ key: 'podsWaiting', waiting: [PVC_MSG] });
  });

  it('says nothing once Repository is done, or when nothing is wrong', () => {
    const done = snap();

    done.upgrades.find((u) => u.metadata.name === 'hvst-upgrade-kflcl').status.conditions.push({ type: 'RepoReady', status: 'True' });
    expect(liveStatus(done).repo).toBeNull();

    const fine = snap();

    fine.images.find((i) => i.metadata.name === 'image-78wgm').spec.backend = 'cdi';
    fine.repoPods = [];
    expect(liveStatus(fine).repo).toBeNull();
  });
});

describe('blockers: uploaded ISO usable', () => {
  const withImages = (images) => ({ ...clone(lab), images });
  const byId = (s, id) => runChecks(s).find((r) => r.id === id);

  it('warns (advisory) about a newer non-cdi ISO and offers a cdi image to copy', () => {
    const r = byId(withImages(TRIM.images(clone(rawImages))), 'isoBackend');

    expect(r).toMatchObject({ status: 'warn', advisory: true });
    expect(r.items.map((i) => i.text)).toStrictEqual(['harvester-v1.9.0-amd64.iso']);
    expect(r.fixes[0].command).toContain('backend: cdi');
    expect(r.fixes[0].command).toContain('displayName: harvester-v1.9.0-amd64.iso');
  });

  it('does not offer a non-cdi ISO as the version to upgrade to', () => {
    const r = byId(withImages(TRIM.images(clone(rawImages))), 'versionAvailable');

    expect(r.args.iso).toBe('');
  });

  it('passes once the ISO is cdi, and does not flag images without a backend', () => {
    const images = TRIM.images(clone(rawImages));

    images.find((i) => i.metadata.name === 'image-78wgm').spec.backend = 'cdi';
    expect(byId(withImages(images), 'isoBackend').status).toBe('pass');
    expect(byId(withImages(images), 'versionAvailable').args.iso).toBe('harvester-v1.9.0-amd64.iso');
    expect(byId(clone(lab), 'isoBackend').status).toBe('pass');
  });
});

describe('history: ISO deleted before the upgrade started', () => {
  it('explains the "image not found" failure', () => {
    const rows = historyRows(TRIM.upgrades(clone(rawUpgrades)), TRIM.images(clone(rawImages)));
    const failed = rows.find((r) => r.name === 'hvst-upgrade-cr6jv');

    expect(failed.failures).toStrictEqual([expect.objectContaining({ type: 'Completed', hint: 'isoDeleted' })]);
    expect(rows.find((r) => r.name === 'hvst-upgrade-kflcl').failures).toStrictEqual([]);
  });
});
