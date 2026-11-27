#!/bin/sh
# Copies the baked source into the tmpfs at /app and runs node from there, so a live patch
# (write into /app, then kill node) never needs a host mount. The loop restarts node on exit.
set -u
cp -R /opt/target/. /app/ || exit 1
cd /app
pid=0
trap 'kill "$pid" 2>/dev/null; exit 0' TERM INT
while true; do
  node server.js &
  pid=$!
  wait "$pid"
  sleep 1
done
