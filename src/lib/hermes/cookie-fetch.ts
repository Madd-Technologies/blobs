/**
 * A `fetch` with a cookie jar, for Node (tests and scripts). The app does not need it: React Native's
 * networking keeps cookies itself. Node's `fetch` has none, and password sign-in depends on the cookie
 * the first step sets (see `auth.ts`), so this stands in for the platform.
 *
 * It sends `redirect: 'manual'` so the 302 that carries the cookie is read rather than followed blind.
 * It honors `Path` and `Secure` the way a phone's cookie store does, so a cookie that would not reach
 * the next request on a device does not reach it here either. Expiry and deletion are ignored: fine for
 * a one-off sign-in against one host.
 */
interface Cookie {
  value: string
  path: string
  secure: boolean
}

export function withCookies(): typeof fetch {
  const jar = new Map<string, Cookie>()

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)

    const send = [...jar]
      .filter(([, cookie]) => url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:'))
      .map(([name, cookie]) => `${name}=${cookie.value}`)

    if (send.length) {
      headers.set('Cookie', send.join('; '))
    }

    const res = await fetch(input, { ...init, headers, redirect: 'manual' })

    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map(part => part.trim())
      const [name, ...value] = (pair ?? '').split('=')

      if (name) {
        jar.set(name.trim(), {
          value: value.join('='),
          path: attributes.find(a => /^path=/i.test(a))?.slice(5) ?? '/',
          secure: attributes.some(a => /^secure$/i.test(a)),
        })
      }
    }

    return res
  }
}
