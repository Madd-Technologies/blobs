/**
 * The app's Hermes server plugins, published at github.com/Madd-Technologies/blobs-hermes-bot-plugins, and the message that has a
 * server's own bot install or update them with Hermes's installer, pinned to one exact commit. Pure.
 *
 * To release: push the plugins repo, then set PLUGINS_COMMIT to that commit and RELEASES to the versions in its
 * plugin.yaml files. Settings → Server plugins compares a server's versions with RELEASES.
 */

export const PLUGINS_REPO = 'Madd-Technologies/blobs-hermes-bot-plugins'
/** `hermes plugins install --ref` takes an exact 40-character commit, so what installs is what was checked. */
export const PLUGINS_COMMIT = '34593996ac438208ae24815e02db320e7f22be65'

export const RELEASES = {
  'hermes-bot-mobile': '0.1.10',
  'hermes-paperless': '0.3.0',
  'hermes-drive': '0.1.0',
  'hermes-dashboard': '0.6.1',
  'hermes-voice': '0.1.2',
  'hermes-phone': '0.1.4',
} as const

export type PluginName = keyof typeof RELEASES

/** What each one is, in a sentence the bot reads before installing it. */
const ABOUT: Record<PluginName, string> = {
  'hermes-bot-mobile':
    'push notifications to my phone when a bot needs me (an approval, a question, a routine that broke, a background task blocked on its kanban card) and, for a bot set to Everything, the start of each reply it gives me, like a message (never that a turn finished or a routine ran), each naming the chat or routine it is about, what bots in a group room are doing right now, what waits on me pushed to the app the moment it changes, restarting the dashboard (and the gateway) from the app, sending a file from this server to one of my devices with Taildrop, and asking me in the app (in the chat the card came from) before a kanban worker runs a command that needs my OK, where Hermes would otherwise refuse it. It replaces the older hermes-push plugin and copies its registered phones on first start.',
  'hermes-paperless': 'streams Paperless documents to my phone’s viewer, a read-only skill for bots, a dashboard tab and a Hermes Desktop page. It reads the Paperless address and token already in ~/.hermes/.env.',
  'hermes-drive': 'streams Google Drive files to my phone’s viewer (Google Docs, Sheets and Slides as PDF) with the google-workspace skill’s sign-in, read only, and a read-only skill for bots.',
  'hermes-dashboard': 'a dashboard for each bot on my phone: collections the bot designs (fields, statuses, drafts and buttons) and panels kept up to date by code wherever possible (panels that read a live source, panels computed from records, script feeds through its write.py), a Background work panel of the bot’s kanban cards (each card a readable task page; a note on a blocked card answers it), record screens the bot lays out from building blocks, drafts to approve shown exactly (HTML too) and sent only if unchanged, and pages behind a count, waking the bot only when something needs judgment, through four dashboard_* tools and a skill. It keeps one SQLite database under ~/.hermes/hermes-dashboard/.',
  'hermes-voice': 'Grok voice calls with my bots from my phone. The phone talks to xAI directly with a one-time secret this server makes from its xAI Grok sign-in or a bot’s own XAI_API_KEY (the token and keys never leave the server), and the Grok voice hands real work to the bot through its normal chat. Routes only (no hooks, tools or skills), so it goes in the default profile only. It keeps each bot’s call settings in ~/.hermes/hermes-voice/bots.json and nothing about calls.',
  'hermes-phone':
    'phone errands for my bots through my own Twilio number (US and Canada): a bot researches and writes a call brief with its phone_call tool, I approve every call in the app, and a separate Grok voice that knows only the approved brief makes the calls and reports back to the bot. It dials only my test numbers until I switch it to live. Its routes serve the app from the default profile, which also gives the default bot its phone_call and phone_call_report tools; the calls themselves run in its own call service (hermes-phone.service), because the dashboard cannot hold Twilio’s audio stream. It keeps its settings, errands and transcripts under ~/.hermes/hermes-phone/.',
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

  if (chosen.includes('hermes-phone')) {
    // Another bot's copy gives that bot the tools; which bots may call is the plugin's own setting, made in the app.
    steps.push(`hermes-phone goes in the default profile only: do not add it to any other profile now (a bot that should make calls gets its own copy later, when I ask). But for every profile in \`hermes profile list\` whose \`hermes -p <profile> plugins list\` already shows hermes-phone, update that copy the same way: \`${installCommand('hermes-phone', commit, '<profile>')}\`.`)
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

  if (chosen.includes('hermes-voice')) {
    steps.push('Voice check, without showing any token: does ~/.hermes/auth.json have an xai-oauth entry with tokens, under providers or credential_pool (yes/no)? Its routes answer only after the restart.')
  }

  if (chosen.includes('hermes-phone')) {
    steps.push('Phone check, without showing any secret: are TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER set in ~/.hermes/.env (yes or no for each)? Does ~/.hermes/auth.json have an xai-oauth entry with tokens, under providers or credential_pool (yes/no)? What does `systemctl --user is-active hermes-phone.service` say? Never ask me to paste a Twilio key into this chat: I add them to ~/.hermes/.env myself. If the call service is not set up yet, show me the Install steps for the call service and the public address from ~/.hermes/plugins/hermes-phone/README.md, and set nothing up until I say so.')
  }

  steps.push(
    `Finish with a short table: each plugin, its version before and after, the validate result and the check result. Then tell me Hermes needs a restart: the dashboard (and the messaging gateway, if one runs here) load plugins when they start${chosen.includes('hermes-phone') ? ', and hermes-phone.service, if it runs, runs the plugin’s own code' : ''}. Do not restart anything.`,
  )

  return [
    `Hermes: please install or update ${chosen.length > 1 ? 'these HermesBot plugins' : 'this HermesBot plugin'} on this Hermes server from GitHub (github.com/${PLUGINS_REPO}), pinned to one exact commit: ${listed}. Follow the steps in order, show me the output of each, and stop and tell me if anything fails. Change nothing else: no other plugins, profiles, bots or config keys. Do NOT restart Hermes or the gateway; I will do that myself. Never print, quote or send me any token, key or secret.`,
    `What ${chosen.length > 1 ? 'they are' : 'it is'}:\n${chosen.map(name => `- ${name}: ${ABOUT[name]}`).join('\n')}`,
    `Steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
  ].join('\n\n')
}
