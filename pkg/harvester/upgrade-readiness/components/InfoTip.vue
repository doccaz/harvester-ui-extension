<script setup>
// Small "i" button that shows an explanation on hover, keyboard focus or tap, so the page keeps only the essentials.
// The tooltip directive also points aria-describedby at the text, so screen readers read it with the button.
defineProps({
  text:  { type: String, required: true },
  label: { type: String, required: true } // accessible name, e.g. "Why does this matter?"
});
</script>

<template>
  <button
    v-clean-tooltip="{ content: text, triggers: ['hover', 'focus', 'click'] }"
    type="button"
    class="info-tip"
    :aria-label="label"
  >
    <i
      class="icon icon-info"
      aria-hidden="true"
    />
  </button>
</template>

<style lang="scss" scoped>
.info-tip {
  display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;
  min-width: 24px; min-height: 24px; margin-left: 4px; padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: var(--link); cursor: help;
  &:focus-visible { outline: 2px solid var(--primary-keyboard-focus, var(--primary)); outline-offset: 1px; }
}
</style>
