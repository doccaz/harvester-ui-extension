<script setup>
import { ref } from 'vue';
import { useStore } from 'vuex';
import { changes, runAction } from '../utils/actions';
import { useTranslation } from '../../utils/use-translation';

// One write, in two steps: the button, then "Confirm / Cancel" naming what will happen. Shown only when changes are allowed.
const props = defineProps({
  kind:   { type: String, required: true },
  target: { type: [String, Object], required: true },
  label:  { type: String, required: true }
});
const emit = defineEmits(['done']);
const t = useTranslation();
const store = useStore();
const step = ref('idle'); // idle | confirm | running | done | error
const error = ref('');
const targetText = () => (typeof props.target === 'string' ? props.target : props.target.node);

async function go() {
  step.value = 'running';
  try {
    await runAction(store, store.getters['currentProduct']?.inStore || 'harvester', props.kind, props.target);
    step.value = 'done';
    emit('done');
  } catch (e) {
    error.value = e?.message || e?._statusText || String(e);
    step.value = 'error';
  }
}
</script>

<template>
  <span
    v-if="changes.allowed"
    class="confirm-action"
    aria-live="polite"
  >
    <button
      v-if="step === 'idle' || step === 'error'"
      type="button"
      class="btn btn-sm role-secondary"
      @click="step = 'confirm'"
    >{{ label }}</button>
    <template v-else-if="step === 'confirm'">
      <span class="question">{{ t(`harvester.upgradeReadiness.action.confirm.${ kind }`, { target: targetText() }) }}</span>
      <button
        type="button"
        class="btn btn-sm role-primary"
        @click="go"
      >{{ t('harvester.upgradeReadiness.action.confirmButton') }}</button>
      <button
        type="button"
        class="btn btn-sm role-secondary"
        @click="step = 'idle'"
      >{{ t('harvester.upgradeReadiness.action.cancel') }}</button>
    </template>
    <span v-else-if="step === 'running'">{{ t('harvester.upgradeReadiness.action.running') }}</span>
    <span
      v-else-if="step === 'done'"
      class="done"
    >{{ t('harvester.upgradeReadiness.action.done') }}</span>
    <span
      v-if="step === 'error'"
      class="error"
    >{{ t('harvester.upgradeReadiness.action.failed', { error }) }}</span>
  </span>
</template>

<style lang="scss" scoped>
.confirm-action { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-left: 8px; }
.question { font-weight: 600; }
.done { padding-left: 6px; border-left: 3px solid var(--success); }
.error { padding-left: 6px; border-left: 3px solid var(--error); }
</style>
