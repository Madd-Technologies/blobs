/**
 * Home's list: one list of bots and rooms. Pinned bots stay first, in the roster's order (their cards are above the list,
 * and their rows are the quick way into their chats); everything else, bots and rooms alike, by latest activity.
 */

export type HomeItem<Bot, Room> = { kind: 'bot'; view: Bot } | { kind: 'room'; view: Room }

export function homeList<Bot extends { pinned: boolean }, Room>(bots: Bot[], rooms: Room[], botActive: (bot: Bot) => number, roomActive: (room: Room) => number): HomeItem<Bot, Room>[] {
  const pinned = bots.filter(bot => bot.pinned).map((view): HomeItem<Bot, Room> => ({ kind: 'bot', view }))
  // A bot and a room as active as each other: the bot first, then each list's own order.
  const rest = [
    ...bots.filter(bot => !bot.pinned).map((view, order) => ({ item: { kind: 'bot', view } as HomeItem<Bot, Room>, at: botActive(view), group: 0, order })),
    ...rooms.map((view, order) => ({ item: { kind: 'room', view } as HomeItem<Bot, Room>, at: roomActive(view), group: 1, order })),
  ].sort((a, b) => b.at - a.at || a.group - b.group || a.order - b.order)

  return [...pinned, ...rest.map(entry => entry.item)]
}
