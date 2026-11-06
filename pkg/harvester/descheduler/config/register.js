import { GROUP, HARVESTER_PRODUCT, NAV_GROUP, PAGES } from './names';
/** Adds Advanced > Descheduler (Overview, Simulator, History) to the Harvester side menu. */
export function registerDescheduler(dsl) {
  const {
    virtualType, basicType, labelGroup, setGroupDefaultType, weightGroup
  } = dsl;

  // The shell keeps Advanced last with a basic-tree weight of -1, but it creates the parent of a nested group
  // (`advanced::descheduler`) with the non-basic weight, which defaults to 0 and moves Advanced to the top. Set both.
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
  labelGroup(GROUP, undefined, 'harvester.descheduler.nav.group');
  basicType(Object.values(PAGES).map((p) => p.type), `${ NAV_GROUP }::${ GROUP }`);
  setGroupDefaultType(GROUP, PAGES.overview.type);
}
