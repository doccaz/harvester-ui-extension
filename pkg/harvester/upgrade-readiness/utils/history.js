/**
 * Upgrade history from the Upgrade records Harvester keeps in harvester-system. What exists after the fact: start time,
 * from/to versions, the source (Version or uploaded ISO), the result, per-node final states, the options used (annotations)
 * and the release contents (`status.repoInfo`). Not kept: durations (conditions carry no timestamps), logs, jobs. Pure.
 */
import { isoVersion } from './checks';

const PAUSE_MAP = 'harvesterhci.io/node-upgrade-pause-map';

/** `status.repoInfo` is YAML-like text: `release:\n  harvester: v1.8.1\n  kubernetes: v1.35.6+rke2r1 ...` */
export function parseRepoInfo(text) {
  const out = {};

  String(text || '').split('\n').forEach((line) => {
    const m = line.match(/^\s+([A-Za-z]+):\s*(.+?)\s*$/);

    if (m) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });

  return out;
}

function resultOf(u) {
  const state = u.metadata.labels?.['harvesterhci.io/upgradeState'] || '';

  if (state === 'Succeeded') {
    return 'succeeded';
  }
  if (state === 'Failed') {
    return 'failed';
  }

  return 'running';
}

/**
 * A plain explanation for failures whose message alone does not say what to do.
 * `virtualmachineimages... "x" not found`: the ISO was gone when the upgrade started. Harvester deletes the upgrade's ISO
 * whenever an upgrade ends (v1.8.2 upgrade_repo.go Cleanup -> deleteVM -> deleteImage), so retrying with it needs a new upload.
 */
export function failureHint(c) {
  // The controller puts this error in `reason`, with an empty message (lab, 2026-11-07).
  return /virtualmachineimages[^"]*"[^"]+" not found/.test(`${ c.message || '' } ${ c.reason || '' }`) ? 'isoDeleted' : '';
}

export function historyRows(upgrades = [], images = []) {
  const imageById = Object.fromEntries(images.map((i) => [`${ i.metadata.namespace }/${ i.metadata.name }`, i]));

  return upgrades.map((u) => {
    const repo = parseRepoInfo(u.status.repoInfo);
    const iso = u.spec.image ? imageById[u.spec.image] || null : null;
    const a = u.metadata.annotations || {};
    const options = [];
    let pause = {};

    try {
      pause = JSON.parse(a[PAUSE_MAP] || '{}');
    } catch (e) {}
    if (Object.keys(pause).length) {
      options.push({ key: 'pauseMap', args: { nodes: Object.entries(pause).map(([n, v]) => `${ n } (${ v })`).join(', ') } });
    }
    if (a['harvesterhci.io/skipSingleReplicaDetachedVol'] === 'true') {
      options.push({ key: 'skipDetached' });
    }
    if (a['harvesterhci.io/skipWebhook'] === 'true') {
      options.push({ key: 'skipWebhook' });
    }
    if (u.spec.logEnabled) {
      options.push({ key: 'logging' });
    }
    if (u.status.singleNode) {
      options.push({ key: 'singleNode', args: { node: u.status.singleNode } });
    }

    return {
      name:       u.metadata.name,
      started:    u.metadata.creationTimestamp,
      from:       u.status.previousVersion || '?',
      to:         u.spec.version || repo.harvester || isoVersion(iso?.spec.displayName) || '?',
      source:     u.spec.version ? 'version' : (u.spec.image ? 'iso' : 'unknown'),
      iso:        iso?.spec.displayName || null,
      imageGone:  !!u.spec.image && !iso,
      result:     resultOf(u),
      state:      u.metadata.labels?.['harvesterhci.io/upgradeState'] || '',
      nodes:      Object.entries(u.status.nodeStatuses || {}).map(([name, st]) => ({
        name, state: st.state || '', reason: st.reason || '', message: st.message || ''
      })),
      failures:   (u.status.conditions || []).filter((c) => c.status === 'False' && (c.message || c.reason)).map((c) => ({
        type: c.type, text: c.message || c.reason, ...(failureHint(c) ? { hint: failureHint(c) } : {})
      })),
      components: {
        kubernetes: repo.kubernetes || '', rancher: repo.rancher || '', os: repo.os || ''
      },
      options
    };
  }).sort((x, y) => String(y.started).localeCompare(String(x.started)));
}
