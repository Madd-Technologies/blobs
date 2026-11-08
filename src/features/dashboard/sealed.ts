/** How an HTML draft is sealed for drawing (hermes-dashboard 0.6+). Pure, so the policy is tested. */

/**
 * Policy for an HTML draft you approve (hermes-dashboard 0.6+): nothing runs and nothing loads. No scripts, no frames, no
 * forms, no fonts or pictures from the network (an email's tracking pixel stays unloaded), only the email's own inline styles.
 */
export const SEALED_CSP = "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; font-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; script-src 'none'; connect-src 'none'; media-src 'none'"

/** The draft's HTML in a page of its own, after a policy that seals it. The draft's bytes are not changed. */
export function sealedDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SEALED_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:16px;background:#ffffff;color:#111111;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;word-wrap:break-word}img{max-width:100%}</style></head><body>${html}</body></html>`
}
