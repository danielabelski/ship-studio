/**
 * Removes `crossorigin` from the `<link rel="stylesheet">` Vite emits.
 *
 * Lives here rather than inline in vite.config.ts so it can be tested without
 * running a build. See the plugin comment in vite.config.ts for why the
 * attribute is removed at all — in short, it forces a CORS check on an asset a
 * Tauri build serves from a custom scheme, and a stylesheet WebKit refuses is
 * invisible: the app mounts and paints itself with no rules, which looks
 * exactly like the app never starting.
 *
 * Deliberately narrow. It only touches a <link> that is a stylesheet, and it
 * leaves the module script alone, because module scripts are fetched in CORS
 * mode whatever the tag says.
 */
export function stripStylesheetCrossorigin(html) {
  return html.replace(/<link\b[^>]*>/g, (tag) => {
    if (!/\brel=["']?stylesheet\b/i.test(tag)) return tag;
    return tag.replace(/\s+crossorigin(=(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, '');
  });
}
