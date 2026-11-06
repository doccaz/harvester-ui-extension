import { clusterRequest } from './cluster';
import { loadSnapshot, SERVING_CERT_ID } from './snapshot';
import { runChecks } from './checks';
import { menuCount } from './menuCount';
import { SOURCES } from './sources';

/** Expiry of the RKE2 serving cert, parsed by the shell's own Secret model (jsrsasign). */
export function certFromStore(store) {
  return async() => {
    const inStore = store.getters['currentProduct']?.inStore || 'harvester';
    const secret = await store.dispatch(`${ inStore }/find`, {
      type: 'secret', id: SERVING_CERT_ID, opt: { force: true }
    });

    return secret?.notAfter ? new Date(secret.notAfter).toISOString() : null;
  };
}

const blocking = (results) => results.filter((r) => r.status === 'block').length;

// Menu badge next to "Blockers": the number of checks that block the upgrade.
const blockers = menuCount(async(store) => blocking(runChecks(await loadSnapshot(clusterRequest(store), certFromStore(store)))));

export const setBlockerCount = (results) => blockers.set(blocking(results));
export const blockerCountGetter = blockers.getter;

// Menu badge next to "History": the number of Upgrade records Harvester keeps.
const history = menuCount(async(store) => ((await clusterRequest(store)({ url: SOURCES.upgrades })).items || []).length);

export const setHistoryCount = history.set;
export const historyCountGetter = history.getter;
