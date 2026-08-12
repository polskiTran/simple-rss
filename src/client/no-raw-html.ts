/**
 * What the bundler puts in place of `rehype-raw`.
 *
 * Streamdown imports rehype-raw — and with it parse5, about 170 kB of the
 * reader's chunk — whether or not the plugin is in the list it is given. This
 * dialect has no raw-HTML path, so the alias in `vite.config.ts`
 * swaps the real plugin for this one, which does nothing. Raw nodes stay
 * unrendered, which is exactly what they do without the plugin at all: the
 * bundle is what changes, never the page.
 */
export default function noRawHtml(): undefined {
  return undefined
}
