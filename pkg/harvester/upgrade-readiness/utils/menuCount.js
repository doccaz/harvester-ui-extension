import { reactive } from 'vue';

/**
 * A number for a side-menu badge, cached. The page it belongs to sets it whenever it loads; the menu's count getter
 * refreshes it in the background when it is older than STALE_MS, and only while that menu item is on screen (Rancher only
 * asks visible items for their count). `load(store)` must resolve to the number and only do GETs.
 */
export const STALE_MS = 5 * 60 * 1000;

export function menuCount(load) {
  const state = reactive({
    count: null, at: 0, loading: false
  });

  function set(n) {
    state.count = n;
    state.at = Date.now();
  }

  async function refresh(store) {
    try {
      set(await load(store));
    } catch (e) {
      state.at = Date.now(); // do not retry in a loop; keep the last known count
    } finally {
      state.loading = false;
    }
  }

  /** `custom.countGetter` for configureType: returns the cached count and schedules a refresh when stale. */
  function getter(store) {
    return () => {
      if (!state.loading && Date.now() - state.at > STALE_MS) {
        state.loading = true;
        setTimeout(() => refresh(store), 0); // never fetch inside a render
      }

      return state.count;
    };
  }

  return {
    set, getter, state
  };
}
