"""Seeds one bot's dashboard (the hermes-dashboard plugin) with no model: a collection, its records and its views.

    HERMES_HOME=<demo home> python3 -I seed_dashboard.py <plugin dir> <profile> <seed.json>

Goes through the plugin's own store, the same code its tools and routes use, writing the shared database at
<demo home>/hermes-dashboard/dashboard.db. A date of "DAY-n" means n days ago. Safe to run again: the collection is
updated, records upsert by source_key and views are replaced by id. Run by scripts/demo/demo.sh.
"""
import datetime
import json
import os
import sys
from pathlib import Path

plugin, profile, seed_path = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
sys.path.insert(0, str(plugin))
import store as S  # noqa: E402  (the plugin's own module)

root = Path(os.environ["HERMES_HOME"]).expanduser().resolve()
seed = json.loads(seed_path.read_text(encoding="utf-8"))
today = datetime.date.today()

for record in seed.get("records", []):
    for key, value in record["values"].items():
        if isinstance(value, str) and value.startswith("DAY-"):
            record["values"][key] = (today - datetime.timedelta(days=int(value[4:]))).isoformat()

store = S.Store(root / "hermes-dashboard")
bot = S.Actor.bot(profile)
collection = seed.get("collection")  # none for a dashboard of stat panels only

if collection:
    try:
        store.create_collection(bot, collection)
    except S.DashboardError:  # already there: refresh its title, description and feed
        store.update_collection(bot, collection["id"], {key: collection[key] for key in ("title", "description", "feed") if key in collection})

if collection and seed.get("records"):
    store.upsert(S.Actor.script(profile), collection["id"], seed["records"])

for view in seed.get("views", []):
    store.set_view(bot, view)

board = store.dashboard(profile, live=False)
for view in board["views"]:
    print(f"  {view['title']}: {view['kind']}, value {view.get('value')}, open {view.get('open')}, needs you {view.get('needs_you')}")
