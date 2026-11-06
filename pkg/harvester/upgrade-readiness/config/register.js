import { GROUP, HARVESTER_PRODUCT, NAV_GROUP, PAGES } from './names';

/**
 * Adds Advanced > Upgrade readiness to the Harvester side menu. Takes `$plugin` and `store` and builds its own DSL,
 * so harvester-cluster.js only needs one call (keeps this branch's edits away from the descheduler branch's).
 */
export function registerUpgradeReadiness($plugin, store) {
  const {
    virtualType, basicType, labelGroup, setGroupDefaultType, weightGroup
  } = $plugin.DSL(store, HARVESTER_PRODUCT);

  // Keep Advanced last (a nested group would otherwise create its parent with weight 0, see the descheduler pages).
  weightGroup(NAV_GROUP, -1, false);

  Object.values(PAGES).forEach((p) => virtualType({
    labelKey: p.labelKey,
    name:     p.type,
    weight:   p.weight,
    route:    {
      name:   p.route,
      params: { product: HARVESTER_PRODUCT }
    }
  }));
  labelGroup(GROUP, undefined, 'harvester.upgradeReadiness.nav.group');
  basicType(Object.values(PAGES).map((p) => p.type), `${ NAV_GROUP }::${ GROUP }`);
  setGroupDefaultType(GROUP, PAGES.readiness.type);
}
