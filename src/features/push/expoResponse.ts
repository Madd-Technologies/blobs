/**
 * Resolves interactive notification actions and notification taps into safe `hermesbot://` deep links. Pure: no React Native imports.
 */

export function resolveNotificationResponseUrl(
  actionIdentifier: string,
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  if (actionIdentifier === 'ALLOW_ONCE' || actionIdentifier === 'DENY') {
    const rawApproval = data.approval
    if (rawApproval && typeof rawApproval === 'object') {
      const approval = rawApproval as Record<string, unknown>
      const id = typeof approval.id === 'string' ? approval.id.trim() : ''
      if (id) {
        const choice = actionIdentifier === 'ALLOW_ONCE' ? 'once' : 'deny'
        const query = new URLSearchParams({ id, choice })
        if (typeof approval.profile === 'string' && approval.profile.trim()) {
          query.set('profile', approval.profile.trim())
        }
        if (typeof approval.kind === 'string' && approval.kind.trim()) {
          query.set('kind', approval.kind.trim())
        }
        return `hermesbot://approve?${query.toString()}`
      }
    }
  }

  const rawUrl = typeof data.url === 'string' ? data.url.trim() : ''
  return rawUrl.startsWith('hermesbot://') ? rawUrl : null
}
