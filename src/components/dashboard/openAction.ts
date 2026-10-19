import { actionFor, safeActionUrl } from '@/features/dashboard/view'
import { serverTarget } from '@/features/viewer/kind'
import { openLink } from '@/lib/openLink'
import { openDocument, openFile } from '@/stores/documents'
import { toast } from '@/stores/toast'

/**
 * Opens a value's link: a server file or plugin document in the viewer; a call, an email or a web page outside the app (a mail in
 * its mail app).
 */
export function openAction(action: NonNullable<ReturnType<typeof actionFor>>, profile: string, name: string): void {
  if (action.kind === 'viewer') {
    const target = serverTarget(action.url)

    if (target?.kind === 'file') {
      openFile(target.path, profile)
    } else if (target?.kind === 'route') {
      openDocument({ kind: 'route', href: target.href, name })
    } else {
      toast('That link can’t be opened from here.')
    }

    return
  }

  const url = safeActionUrl(action.url)

  if (url) {
    void openLink(url)
  } else {
    toast('That link can’t be opened from here.')
  }
}
