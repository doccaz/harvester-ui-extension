import { useStore } from 'vuex';
/**
 * Non-escaping `t` for `<script setup>` components. Shell's global `t` HTML-escapes its output, which shows up as
 * `&#39;` when used in a mustache or an attribute binding.
 */
export function useTranslation() {
  const store = useStore();

  return (key, args) => store.getters['i18n/t'](key, args);
}
