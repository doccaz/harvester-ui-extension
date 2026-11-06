import { reactive } from 'vue';
import { clusterRequest } from './cluster';
import { loadSnapshot, SERVING_CERT_ID } from './snapshot';
import { runChecks } from './checks';

/**
 * Number of upgrade blockers for the side-menu badge next to "Blockers". The Blockers page sets it whenever it runs; the
 * menu's count getter refreshes it in the background when it is older than STALE_MS, and only while that menu item is on
 * screen (Rancher only asks visible items for their count). Read-only GETs, as on the page.
 */
const STALE_MS = 5 * 60 * 1000;
const state = reactive({
  count: null, at: 0, loading: false
});

export function setBlockerCount(results) {
  state.count = results.filter((r) => r.status === 'block').length;
  state.at = Date.now();
}

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

async function refresh(store) {
  state.loading = true;
  try {
    setBlockerCount(runChecks(await loadSnapshot(clusterRequest(store), certFromStore(store))));
  } catch (e) {
    state.at = Date.now(); // do not retry in a loop; keep the last known count
  } finally {
    state.loading = false;
  }
}

/** `custom.countGetter` for configureType: returns the cached count and schedules a refresh when stale. */
export function blockerCountGetter(store) {
  return () => {
    if (!state.loading && Date.now() - state.at > STALE_MS) {
      state.loading = true;
      setTimeout(() => refresh(store), 0); // never fetch inside a render
    }

    return state.count;
  };
}
