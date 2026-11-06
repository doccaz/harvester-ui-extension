import ReadinessPage from '../pages/readiness.vue';
import PlanPage from '../pages/plan.vue';
import HistoryPage from '../pages/history.vue';
import ProbePage from '../pages/probe.vue';
import { PAGES } from './names';

const page = (p, component) => ({
  name: p.route, path: `/:product/c/:cluster/${ p.path }`, component
});

export const upgradeReadinessRoutes = [
  page(PAGES.readiness, ReadinessPage),
  page(PAGES.plan, PlanPage),
  page(PAGES.history, HistoryPage),
  page(PAGES.probe, ProbePage)
];
