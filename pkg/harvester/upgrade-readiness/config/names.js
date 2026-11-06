import { PRODUCT_NAME } from '../../config/harvester';
// Pages are added to Harvester's own product (Advanced menu), like the descheduler pages: the standalone
// dashboard has no product switcher, so a product of our own would have no menu entry.
export const HARVESTER_PRODUCT = PRODUCT_NAME;
export const NAV_GROUP = 'advanced';
export const GROUP = 'upgrade-readiness';
const route = (suffix) => `${ HARVESTER_PRODUCT }-c-cluster-upgrade-readiness${ suffix }`;

// Sibling paths on purpose (see the descheduler pages: a path prefix of another marks both menu items active).
export const PAGES = {
  readiness: {
    type: 'upgrade-readiness-blockers', path: 'upgrade-readiness/blockers', route: route('-blockers'), weight: 4, labelKey: 'harvester.upgradeReadiness.nav.readiness'
  },
  plan: {
    type: 'upgrade-readiness-plan', path: 'upgrade-readiness/plan', route: route('-plan'), weight: 3, labelKey: 'harvester.upgradeReadiness.nav.plan'
  },
  history: {
    type: 'upgrade-readiness-history', path: 'upgrade-readiness/history', route: route('-history'), weight: 2, labelKey: 'harvester.upgradeReadiness.nav.history'
  }
};
