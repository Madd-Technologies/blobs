/**
 * The app's Hermes server plugins, published at github.com/Madd-Technologies/blobs-hermes-bot-plugins, and the message that has a
 * server's own bot install or update them with Hermes's installer, pinned to one exact commit. Pure.
 *
 * To release: push the plugins repo, then set PLUGINS_COMMIT to that commit and RELEASES to the versions in its
 * plugin.yaml files. Settings → Server plugins compares a server's versions with RELEASES.
 */

export const PLUGINS_REPO = 'Madd-Technologies/blobs-hermes-bot-plugins'
/** `hermes plugins install --ref` takes an exact 40-character commit, so what installs is what was checked. */
export const PLUGINS_COMMIT = 'd8f7a0c5352afe0aae2b465064d2e3539073abd0'

export const RELEASES = {
  'hermes-bot-mobile': '0.1.5',
  'hermes-paperless': '0.3.0',
  'hermes-drive': '0.1.0',
  'hermes-dashboard': '0.5.0',
} as const

export type PluginName = keyof typeof RELEASES

/** What each one is, in a sentence the bot reads before installing it. */
const ABOUT: Record<PluginName, string> = {
  'hermes-bot-mobile':
    'push notifications to my phone when a bot needs me (an approval, a question, a routine that broke, a background task blocked on its kanban card) and, for a bot set to Everything, the start of each reply it gives me, like a message (never that a turn finished or a routine ran), each naming the chat or routine it is about, and what bots in a group room are doing right now. It replaces the older hermes-push plugin and copies its registered phones on first start.',
  'hermes-paperless': 'streams Paperless documents to my phone’s viewer, a read-only skill for bots, a dashboard tab and a Hermes Desktop page. It reads the Paperless address and token already in ~/.hermes/.env.',
  'hermes-drive': 'streams Google Drive files to my phone’s viewer (Google Docs, Sheets and Slides as PDF) with the google-workspace skill’s sign-in, read only, and a read-only skill for bots.',
  'hermes-dashboard': 'a dashboard for each bot on my phone: collections the bot designs (fields, statuses, drafts and buttons) and panels kept up to date by code wherever possible (panels that read a live source, panels computed from records, script feeds through its write.py), a Background work panel of the bot’s kanban cards (a note on a blocked card answers it), waking the bot only when something needs judgment, through four dashboard_* tools and a skill. It keeps one SQLite database under ~/.hermes/hermes-dashboard/.',
}

/**
 * Plugins whose tools each bot needs a copy of: Hermes loads user plugins per profile (`<profile home>/plugins`), so one in
 * the default profile serves the app's routes and that bot only.
 */
export const PER_BOT: readonly PluginName[] = ['hermes-dashboard']

/** Hermes profile names, as the `-p` flag takes them. */
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The install command, in the default profile, or in `profile` with Hermes's global `-p` flag. */
export function installCommand(name: PluginName, commit: string = PLUGINS_COMMIT, profile?: string): string {
  const scope = profile && profile !== 'default' ? `-p ${profile} ` : ''

  return `hermes ${scope}plugins install ${PLUGINS_REPO}/${name} --ref ${commit} --force --enable`
}

/** The commands that install one plugin: once in the default profile, and again in each of `bots` when it is per bot. */
function installCommands(name: PluginName, commit: string, bots: readonly string[]): string[] {
  const extra = PER_BOT.includes(name) ? bots.filter(bot => bot !== 'default' && PROFILE.test(bot)) : []

  return [installCommand(name, commit), ...extra.map(bot => installCommand(name, commit, bot))]
}

/**
 * One message for the server's bot that installs or updates these plugins, checks them, and leaves the restart to you.
 * `bots`: the profiles that get their own copy of a per-bot plugin (the app's pinned bots).
 */
export function installMessage(names: readonly PluginName[], commit: string = PLUGINS_COMMIT, bots: readonly string[] = []): string {
  const chosen = (Object.keys(RELEASES) as PluginName[]).filter(name => names.includes(name))
  const listed = chosen.map(name => `${name} ${RELEASES[name]}`).join(', ')
  const perBot = chosen.filter(name => PER_BOT.includes(name))
  const named = bots.filter(bot => bot !== 'default' && PROFILE.test(bot))
  const steps: string[] = [
    `Install ${chosen.length > 1 ? 'each one' : 'it'} with Hermes's own installer. It clones the public repository at that exact commit, checks it and enables it; --force replaces an existing copy of the same plugin (the plugins keep their data outside their folders, so nothing is lost). If the installer asks a question or refuses, stop and show me what it said.\n${chosen.flatMap(name => installCommands(name, commit, bots)).map(command => `   ${command}`).join('\n')}`,
  ]

  if (perBot.length && named.length) {
    steps.push(`${perBot.join(' and ')} ${perBot.length > 1 ? 'are' : 'is'} installed once for each bot that uses ${perBot.length > 1 ? 'them' : 'it'} (Hermes loads plugins per profile): the default profile, which serves the app, and ${named.join(', ')} with \`-p <profile>\`. If a profile does not exist, skip it and tell me.`)
  }

  if (chosen.includes('hermes-bot-mobile')) {
    // A bot's own copy sends that bot's pushes, and an update to the default profile's copy leaves the others as they were.
    steps.push(`Other bots may have their own copy of hermes-bot-mobile (Hermes loads plugins per profile, and each copy sends that bot's pushes). For every profile in \`hermes profile list\` whose \`hermes -p <profile> plugins list\` shows hermes-bot-mobile, update that copy the same way: \`${installCommand('hermes-bot-mobile', commit, '<profile>')}\`. Do not add it to a profile that does not have it.`)
    steps.push('hermes-bot-mobile replaces the older hermes-push plugin. If `hermes plugins list` shows hermes-push, run `hermes plugins disable hermes-push` (do not remove it: its folder is the rollback, and hermes-bot-mobile copies its registered phones from ~/.hermes/hermes-push/ on first start).')
  }

  steps.push(`Show me the rows of \`hermes plugins list\` for ${chosen.join(', ')}${chosen.includes('hermes-bot-mobile') ? ' and hermes-push' : ''}${perBot.length && named.length ? `, and of \`hermes -p <profile> plugins list\` for ${perBot.join(', ')} in each of ${named.join(', ')}` : ''}.`)
  steps.push(`Run \`hermes plugins validate ~/.hermes/plugins/<name>\` for ${chosen.length > 1 ? 'each one' : 'it'} and show me the last line ("Validation passed" or what failed).`)

  if (chosen.includes('hermes-dashboard')) {
    steps.push('Dashboard check: plugin toolsets are on by default, so the `dashboard` toolset should be on for each bot that got the plugin (`hermes tools`, `hermes -p <profile> tools`). Say yes or no for each; do not change any toolset setting yourself.')
  }

  if (chosen.includes('hermes-paperless')) {
    steps.push('Paperless check, without showing its token: `python3 ~/.hermes/plugins/hermes-paperless/skills/paperless/scripts/find.py recent --limit 1`. It should list one document with a link; if it prints an error instead, show me the error (it never contains a token).')
  }

  if (chosen.includes('hermes-drive')) {
    steps.push('Drive check, without showing any token: does ~/.hermes/google_token.json have a scope containing auth/drive (yes/no)? Then `python3 ~/.hermes/plugins/hermes-drive/skills/drive/scripts/find.py recent --limit 1`. It should list one file with a link; if it prints an error instead, show me the error (it never contains a token).')
  }

  steps.push('Finish with a short table: each plugin, its version before and after, the validate result and the check result. Then tell me Hermes needs a restart: the dashboard (and the messaging gateway, if one runs here) load plugins when they start. Do not restart anything.')

  return [
    `Hermes: please install or update ${chosen.length > 1 ? 'these HermesBot plugins' : 'this HermesBot plugin'} on this Hermes server from GitHub (github.com/${PLUGINS_REPO}), pinned to one exact commit: ${listed}. Follow the steps in order, show me the output of each, and stop and tell me if anything fails. Change nothing else: no other plugins, profiles, bots or config keys. Do NOT restart Hermes or the gateway; I will do that myself. Never print, quote or send me any token, key or secret.`,
    `What ${chosen.length > 1 ? 'they are' : 'it is'}:\n${chosen.map(name => `- ${name}: ${ABOUT[name]}`).join('\n')}`,
    `Steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
  ].join('\n\n')
}
