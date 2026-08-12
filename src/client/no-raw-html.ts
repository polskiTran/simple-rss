/**
 * Aliased over `rehype-raw` in `vite.config.ts`: Streamdown imports it (and
 * parse5, ~170 kB) even unused, and this dialect has no raw-HTML path. Raw
 * nodes stay unrendered either way; only the bundle changes.
 */
export default function noRawHtml(): undefined {
  return undefined
}
