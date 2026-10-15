/** A route in the root stack, as the navigator reports it. */
export interface StackRoute {
  name: string
  params?: object
}

/** Whether this bot's chat is somewhere in the stack, so going "back to the chat" can return to it instead of opening another. */
export function chatInStack(routes: readonly StackRoute[] | undefined, profile: string): boolean {
  return !!routes?.some(route => route.name === 'bot/[profile]/index' && (route.params as { profile?: unknown } | undefined)?.profile === profile)
}
