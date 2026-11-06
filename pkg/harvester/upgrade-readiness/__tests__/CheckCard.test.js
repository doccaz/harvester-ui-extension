import { mount } from '@vue/test-utils';
import lab from './fixtures/lab-2026-11-06.json';
import blocked from '../dev/drift-kubevip-blocked.json';
import { runChecks } from '../utils/checks';
import CheckCard from '../components/CheckCard.vue';

// The i18n getter (used by script code) echoes key + args; template `t` comes from jest.setup's global mock (%key%).
jest.mock('vuex', () => ({ useStore: () => ({ getters: { 'i18n/t': (key, args) => `${ key }${ args ? JSON.stringify(args) : '' }` } }) }));
jest.mock('vue-router', () => ({ useRoute: () => ({ params: { cluster: 'local' } }) }));

const stubs = {
  RcSection:       { template: '<section><slot name="title" /><slot name="badges" /><slot /></section>' },
  RcSectionBadges: true,
  CopyToClipboard: true,
  'router-link':   { props: ['to'], template: '<a><slot /></a>' }
};
const results = Object.fromEntries(runChecks(lab).map((c) => [c.id, c]));
const render = (check) => mount(CheckCard, { props: { check }, global: { stubs } });

describe('checkCard', () => {
  it('renders every lab result without errors', () => {
    Object.values(results).forEach((check) => expect(() => render(check)).not.toThrow());
  });

  it('titles a failing check by its problem', () => {
    expect(render(results.nonMigratable).find('h2').text()).toBe('harvester.upgradeReadiness.check.nonMigratable.problem');
  });

  it('explains the GPU VM in words, not just the device id', () => {
    const text = render(results.nonMigratable).text();

    expect(text).toContain('check.nonMigratable.reason.device');
    expect(text).toContain('GB205 GEFORCE RTX 5070');
  });

  it('shows what to do about the stuck replica, with a Longhorn link and the exact delete command', () => {
    const w = render(results.singleReplica);

    // jest.setup's global `t` mock renders template keys as %key% (args are checked in checks.test.js).
    expect(w.find('.hint-row').text()).toContain('replica.stuckHint');
    expect(w.find('.hint-row a').attributes('href')).toContain('longhorn-frontend:80/proxy/#/volume/pvc-534bc17f-8aaa-49b7-8d9b-f414b3150b50');
    expect(w.find('.hint-row code').text()).toBe('kubectl -n longhorn-system delete replicas.longhorn.io pvc-534bc17f-8aaa-49b7-8d9b-f414b3150b50-r-8208dd79');
    expect(w.findAll('.hint-row')).toHaveLength(1);
  });

  it('explains the blocked system chart: owner file, Fleet error, fix steps, stale entries', () => {
    const snap = {
      ...JSON.parse(JSON.stringify(lab)),
      managedCharts:     blocked.managedCharts,
      bundleDeployments: blocked.bundleDeployments,
      drift:             {
        live: blocked.live, k3sAddons: blocked.k3sAddons, fleetLog: '', errors: {}
      },
      now: blocked.now
    };
    const check = runChecks(snap).find((c) => c.id === 'managedCharts');

    expect(check.status).toBe('block');
    const w = render(check);
    const kv = w.findAll('.drift-row').find((r) => r.text().includes('DaemonSet harvester-system/kube-vip'));

    expect(kv.find('.tag').text()).toContain('drift.type.notOwned');
    expect(kv.find('details').attributes('open')).toBeDefined();
    expect(kv.findAll('.steps code').map((c) => c.text())).toContain('kubectl delete -n harvester-system daemonset kube-vip --ignore-not-found');
    expect(kv.find('.risk').text()).toContain('drift.risk.kubeVip');
    expect(w.findAll('.fields tbody tr')).toHaveLength(1);
    expect(w.text()).toContain('drift.stale');
    expect(w.findAll('.drift-row')).toHaveLength(2);
  });
});
