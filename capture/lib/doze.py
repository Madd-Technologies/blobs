"""Puts a demo bot to sleep: moves its chats back in time so the app draws its eyes shut.

The app dozes a bot whose last activity is 6 hours old or more (`DOZE_AFTER_S`, src/features/face/motion.ts). A demo
reset runs Ember's routine just now, so the capture rig moves Ember's sessions and messages back by enough to doze.
Hermes reads a session's last activity as the newest of `last_activity_at`, its newest message and `started_at`
(`_sql_freshest_of` in hermes_state_common.py), so those are the columns that move.

    python -I capture/lib/doze.py <demo HERMES_HOME> <bot> <hours ago>

Only ever opens `<home>/profiles/<bot>/state.db`, and refuses a home that is not the demo's.
"""

import os
import sqlite3
import sys
import time


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit("usage: doze.py <demo HERMES_HOME> <bot> <hours ago>")

    home, bot, hours = sys.argv[1], sys.argv[2], float(sys.argv[3])
    config = os.path.join(home, "config.yaml")

    # The demo's config.yaml starts with this line (scripts/demo/demo.sh); a real Hermes home never does.
    with open(config, encoding="utf-8") as handle:
        if "The demo Hermes" not in handle.readline():
            sys.exit(f"doze: {home} is not the demo Hermes; refusing to touch it")

    if not bot.isidentifier():
        sys.exit(f"doze: '{bot}' is not a bot name")

    path = os.path.join(home, "profiles", bot, "state.db")
    db = sqlite3.connect(path, timeout=30)

    with db:
        newest = db.execute(
            "SELECT MAX(v) FROM (SELECT MAX(COALESCE(last_activity_at, started_at)) AS v FROM sessions"
            " UNION ALL SELECT MAX(timestamp) FROM messages)"
        ).fetchone()[0]

        if not newest:
            sys.exit(f"doze: {bot} has no chats yet")

        shift = newest - (time.time() - hours * 3600)

        if shift <= 0:
            print(f"doze: {bot} already last did something {hours:g} h ago or more")
            return

        db.execute(
            "UPDATE sessions SET started_at = started_at - ?1,"
            " last_activity_at = last_activity_at - ?1, ended_at = ended_at - ?1",
            (shift,),
        )
        db.execute("UPDATE messages SET timestamp = timestamp - ?1", (shift,))

    db.close()
    print(f"doze: moved {bot}'s chats back {shift / 3600:.1f} h, so it last did something {hours:g} h ago")


if __name__ == "__main__":
    main()
