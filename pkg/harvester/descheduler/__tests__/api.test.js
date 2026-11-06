import { deschedulerPod } from '../utils/api';

const pod = (name, label, phase = 'Running') => ({
  metadata: {
    name, namespace: 'kube-system', labels: { 'app.kubernetes.io/name': label }
  },
  status: { phase }
});

describe('deschedulerPod', () => {
  it('matches the add-on pod by label, never a dry-run pod', () => {
    // sorted by name, the dry-run pod comes first: a name-prefix match would pick it
    const pods = [pod('descheduler-dry-run-20261104183005-x', 'descheduler-dry-run'), pod('descheduler-f7c9-abc', 'descheduler')];

    expect(deschedulerPod(pods).metadata.name).toBe('descheduler-f7c9-abc');
  });
  it('ignores finished pods', () => {
    expect(deschedulerPod([pod('descheduler-old', 'descheduler', 'Failed')])).toBeUndefined();
  });
});
