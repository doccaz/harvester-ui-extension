import YAML from 'yaml';
/**
 * The only module that knows which YAML library is in use. It keeps a js-yaml-like call shape so callers can inject another
 * library in tests. Parsing uses the YAML 1.2 core schema (plain maps, lists and scalars).
 */
export default {
  load: (text) => YAML.parse(text, { logLevel: 'error' }),
  dump: (value) => YAML.stringify(value, { lineWidth: 0 })
};
