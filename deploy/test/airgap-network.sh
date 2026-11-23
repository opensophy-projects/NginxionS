#!/bin/sh
# Probe TCP from the edge network. A listening service counts even when it never responds.
set -eu

connections() {
  # curl can time out after connecting, or exit with an error because the port is closed.
  # num_connects distinguishes these cases without depending on the time of the connection.
  curl --disable --noproxy '*' -s -o /dev/null -w '%{num_connects}' \
    --connect-timeout 2 --max-time 3 "telnet://$1" < /dev/null || true
}

control=$1
shift
if [ "$(connections "$control")" != 1 ]; then
  echo "FAIL: the network probe cannot reach its control endpoint ($control)" >&2
  exit 1
fi
bad=""
for endpoint do
  case "$(connections "$endpoint")" in
    0) ;;
    1) bad="$bad $endpoint" ;;
    *) echo "FAIL: no valid measurement for $endpoint" >&2; exit 1 ;;
  esac
done
if [ -n "$bad" ]; then
  echo "FAIL: reachable from the edge network:$bad" >&2
  exit 1
fi
echo "    none reachable"
