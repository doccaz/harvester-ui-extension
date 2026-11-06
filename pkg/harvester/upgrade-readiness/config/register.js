import { markRaw } from 'vue';
import { GROUP, HARVESTER_PRODUCT, NAV_GROUP, PAGES } from './names';
import { HCI } from '../../types';
import { blockerCountGetter, historyCountGetter } from '../utils/blockerCount';

/**
 * Adds Advanced > Upgrade readiness to the Harvester side menu. Takes `$plugin` and `store` and builds its own DSL,
 * so harvester-cluster.js only needs one call (keeps this branch's edits away from the descheduler branch's).
 */
export function registerUpgradeReadiness($plugin, store) {
  const {
    virtualType, basicType, labelGroup, setGroupDefaultType, weightGroup, configureType
  } = $plugin.DSL(store, HARVESTER_PRODUCT);

  // Keep Advanced last (a nested group would otherwise create its parent with weight 0, see the descheduler pages).
  weightGroup(NAV_GROUP, -1, false);

  // Only for users who can see Upgrades (the same test as the upgrade button in the header). Hidden items are never asked
  // for their menu count, so other users also make no background requests.
  Object.values(PAGES).forEach((p) => virtualType({
    labelKey:   p.labelKey,
    name:       p.type,
    weight:     p.weight,
    ifHaveType: HCI.UPGRADE,
    route:      {
      name:   p.route,
      params: { product: HARVESTER_PRODUCT }
    }
  }));
  labelGroup(GROUP, undefined, 'harvester.upgradeReadiness.nav.group');
  basicType(Object.values(PAGES).map((p) => p.type), `${ NAV_GROUP }::${ GROUP }`);
  setGroupDefaultType(GROUP, PAGES.readiness.type);
  // Blocker count next to "Blockers" in the menu (same mechanism Rancher uses for its cluster count).
  configureType(PAGES.readiness.type, { custom: { countGetter: markRaw(blockerCountGetter(store)) } });
  // Number of past upgrade records next to "History".
  configureType(PAGES.history.type, { custom: { countGetter: markRaw(historyCountGetter(store)) } });
}
