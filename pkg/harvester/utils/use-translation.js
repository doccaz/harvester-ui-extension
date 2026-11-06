import { useStore } from 'vuex';
import { useI18n } from '@shell/composables/useI18n';

/**
 * `t` for `<script setup>` components that returns the raw string. The shell's `t` HTML-escapes by default, which shows up
 * as `&#39;` once Vue escapes it again in a mustache or an attribute binding.
 */
export function useTranslation() {
  const { t } = useI18n(useStore());

  return (key, args) => t(key, args, true);
}
