#!/bin/sh
# Opens the shop preview in a browser window on this sandbox's screen (a Hermes bot's Bot Screen).
# The screen runs as the image's desktop user; a bot's commands run as root, so the browser is started as that user.
# The container is the sandbox, so Chromium's own is off, as for Hermes's dock browser (--test-type hides the
# warning bar that would otherwise sit across the top of the screen).
url="${1:-http://localhost:4173}"
envfile=$(ls /tmp/hermes-bot-desktop/*/env 2>/dev/null | head -n 1)
if [ -z "$envfile" ]; then
  echo "no screen is running in this sandbox" >&2
  exit 1
fi
set -a
. "$envfile"
set +a
chrome=$(ls -d /opt/playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -n 1)
[ -n "$chrome" ] || chrome=$(command -v chromium || command -v google-chrome)
[ -n "$chrome" ] || { echo "no browser in this sandbox" >&2; exit 1; }
run=""
if [ "$(id -u)" = 0 ] && id pn >/dev/null 2>&1; then
  run="runuser -u pn --"
fi
$run env DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
  XDG_CONFIG_HOME="$XDG_CONFIG_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME" XDG_DATA_HOME="$XDG_DATA_HOME" \
  nohup "$chrome" --user-data-dir=/tmp/storefront-browser --no-first-run --no-default-browser-check \
  --no-sandbox --test-type --disable-infobars --disable-features=Translate --password-store=basic --start-maximized "$url" >/dev/null 2>&1 &
echo "opened $url on the screen"
