#!/bin/sh
# Tests of the Lua modules of NginxionS in nginx (scripts/lua/*.test.lua) with LuaJIT, the Lua of nginx.
set -eu
cd "$(dirname "$0")/.."
command -v luajit > /dev/null || { echo "luajit is needed (apt-get install luajit)"; exit 1; }
status=0
for t in scripts/lua/*.test.lua; do
  echo "== $t"
  luajit "$t" nginxions/rootfs/usr/local/lua/nginxions || status=1
done
exit $status
