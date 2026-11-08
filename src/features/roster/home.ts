/**
 * Home's list: one list of bots and rooms. Pinned bots stay first (their cards are above the list, and their rows are the
 * quick way into their chats); everything else, bots and rooms alike, after them. Both by `botActive`/`roomActive`: for a
 * bot that is when you last talked with it, so background work never reorders the list.
 */

export type HomeItem<Bot, Room> = { kind: 'bot'; view: Bot } | { kind: 'room'; view: Room }

export function homeList<Bot extends { pinned: boolean }, Room>(bots: Bot[], rooms: Room[], botActive: (bot: Bot) => number, roomActive: (room: Room) => number): HomeItem<Bot, Room>[] {
  // The roster's own order (by the server's last activity, which counts background work) only breaks ties.
  const pinned = bots
    .filter(bot => bot.pinned)
    .map((view, order) => ({ view, at: botActive(view), order }))
    .sort((a, b) => b.at - a.at || a.order - b.order)
    .map((entry): HomeItem<Bot, Room> => ({ kind: 'bot', view: entry.view }))
  // A bot and a room as active as each other: the bot first, then each list's own order.
  const rest = [
    ...bots.filter(bot => !bot.pinned).map((view, order) => ({ item: { kind: 'bot', view } as HomeItem<Bot, Room>, at: botActive(view), group: 0, order })),
    ...rooms.map((view, order) => ({ item: { kind: 'room', view } as HomeItem<Bot, Room>, at: roomActive(view), group: 1, order })),
  ].sort((a, b) => b.at - a.at || a.group - b.group || a.order - b.order)

  return [...pinned, ...rest.map(entry => entry.item)]
}
