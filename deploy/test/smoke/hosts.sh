# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «hosts» (deploy/test/smoke.sh runs it in a subshell of its own): hosts: upstreams, error pages, history, redirects, ACME, default page, streams, access lists.


step "hosts: the upstream of test.local answers, a dead one does not"
$CURL "$ADMIN/api/nginxions/hosts/upstreams" | tr -d ' \n' | grep -q '"object_id":1,"host":"test-upstream","port":80,"ok":true' \
  || fail "upstream check of test.local: $($CURL "$ADMIN/api/nginxions/hosts/upstreams")"
$CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d '{
  "domain_names": ["dead-upstream.local"], "forward_scheme": "http",
  "forward_host": "127.0.0.1", "forward_port": "9"
}' > /dev/null
$CURL "$ADMIN/api/nginxions/hosts/upstreams" | tr -d ' \n' | grep -q '"port":9,"ok":false' \
  || fail "a closed port is reported as reachable: $($CURL "$ADMIN/api/nginxions/hosts/upstreams")"

step "error pages: the 502 of a dead upstream is the page of NginxionS, not the bare page of nginx"
page=""
for i in $(seq 1 15); do
  page=$(curl -sS --max-time 10 -H 'Host: dead-upstream.local' "$HTTP/" || true)
  echo "$page" | grep -q 'The site does not answer' && break
  [ "$i" = 15 ] && fail "502 of a dead upstream: $(echo "$page" | head -c 300)"
  sleep 1
done
echo "$page" | grep -q 'Сайт не отвечает' || fail "502: no Russian text"
echo "$page" | grep -q 'nginx</center>' && fail "502: the bare page of nginx"

step "hosts: who changed test.local and when (audit log)"
$CURL "$ADMIN/api/nginxions/hosts/changes" | tr -d ' \n' | grep -q '"type":"proxy-host","object_id":1,' \
  || fail "no last change of test.local: $($CURL "$ADMIN/api/nginxions/hosts/changes")"
$CURL "$ADMIN/api/nginxions/hosts/changes/proxy-host/1" | grep -q '"action": *"created"' \
  || fail "the history of test.local has no creation: $($CURL "$ADMIN/api/nginxions/hosts/changes/proxy-host/1")"

host_code() { h=$1; shift; curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -H "Host: $h" "$@" "$HTTP$PATH_"; }
host_location() { curl -sS --max-time 10 -o /dev/null -D - -H "Host: $1" "$HTTP$2" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p'; }
new_json() { $CURL -H 'Content-Type: application/json' "$@"; }
id_of() { tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*$'; }
want() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1"; }

step "redirects: every code sends Location with the path (300 too), the scheme «auto» of the old form keeps the scheme"
for code in 300 301 302 303 307 308; do
  new_json "$ADMIN/api/nginx/redirection-hosts" -d "{\"domain_names\": [\"r$code.local\"], \"forward_scheme\": \"https\",
    \"forward_domain_name\": \"target.local\", \"forward_http_code\": $code, \"preserve_path\": true, \"meta\": {}}" > /dev/null
done
new_json "$ADMIN/api/nginx/redirection-hosts" -d '{"domain_names": ["rauto.local"], "forward_scheme": "auto",
  "forward_domain_name": "target.local", "forward_http_code": 302, "preserve_path": true, "meta": {}}' > /dev/null
sleep 2
for code in 300 301 302 303 307 308; do
  PATH_='/a/b?c=1'; got=$(host_code "r$code.local")
  [ "$got" = "$code" ] || fail "redirect $code answered $got"
  loc=$(host_location "r$code.local" "/a/b?c=1")
  [ "$loc" = "https://target.local/a/b?c=1" ] || fail "redirect $code: Location '$loc'"
done
loc=$(host_location rauto.local /p)
[ "$loc" = "http://target.local/p" ] || fail "redirect with the scheme auto: Location '$loc' (not auto://)"

step "ACME servers: a default one at the start, presets, lego in the image; the TLS CA needs lego"
servers=$($CURL "$ADMIN/api/nginxions/acme/servers")
echo "$servers" | tr -d ' \n' | grep -q '"is_default":true' || fail "no default ACME server: $servers"
echo "$servers" | grep -q '"tlscc-stage"' || fail "the presets have no TLS CA: $(echo "$servers" | head -c 300)"
# the codes come from `lego dnshelp`: lego is in the image and runs
$CURL "$ADMIN/api/nginxions/acme/lego/dns-providers" | grep -q '"rfc2136"' || fail "lego does not list its DNS providers"
got=$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Content-Type: application/json' "$ADMIN/api/nginxions/acme/servers" \
  -d '{"preset": "tlscc-stage", "client": "certbot"}')
[ "$got" = 400 ] || fail "the TLS CA with certbot answered $got (certbot cannot register there)"
own=$(new_json "$ADMIN/api/nginxions/acme/servers" -d '{"name": "smoke own", "directory": "https://ca.internal/acme/directory",
  "client": "lego", "eab_kid": "kid", "eab_hmac_key": "smoke-hmac-secret", "email": "ops@example.com"}')
echo "$own" | grep -q 'smoke-hmac-secret' && fail "the EAB key is returned by the API"
own_id=$(echo "$own" | id_of)
$CURL -X DELETE "$ADMIN/api/nginxions/acme/servers/$own_id" > /dev/null || fail "the ACME server is not removed"

step "ACME HTTP-01: the challenge of a domain without a host is answered over HTTP, not sent to HTTPS"
PATH_=/.well-known/acme-challenge/missing; got=$(host_code no-host.local)
[ "$got" = 404 ] || fail "the challenge path answered $got (a 301 sends the ACME server to the dummy certificate)"
PATH_=/x; got=$(host_code no-host.local)
[ "$got" = 301 ] || fail "other paths of HTTP: expected 301 to HTTPS, got $got"
curl -sSk --max-time 10 -H 'Host: no-host.local' https://nginxions/ \
  | grep -q 'NginxionS is running' || fail "the default page is not the page of NginxionS"

step "default page «no answer» (444): an unknown host gets nothing, the ACME challenge still answers"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/settings/default-site" -d '{"value": "444", "meta": {}}' > /dev/null
sleep 2
rc=0; curl -sS --max-time 10 -o /dev/null -H 'Host: no-host.local' "$HTTP/" 2>/dev/null || rc=$?
[ "$rc" = 52 ] || [ "$rc" = 56 ] || fail "444: curl exit code $rc (expected an empty reply)"
PATH_=/.well-known/acme-challenge/missing; got=$(host_code no-host.local)
[ "$got" = 404 ] || fail "444: the challenge path answered $got"
$CURL -X PUT -H 'Content-Type: application/json' "$ADMIN/api/settings/default-site" \
  -d '{"value": "congratulations", "meta": {}}' > /dev/null

step "streams: TCP port to the upstream; a second stream on a busy port and the ports of NginxionS are refused"
stream_body() { echo "{\"incoming_port\": \"$1\", \"forwarding_host\": \"test-upstream\", \"forwarding_port\": 80,
  \"tcp_forwarding\": true, \"udp_forwarding\": false, \"meta\": {}}"; }
sid=$(new_json "$ADMIN/api/nginx/streams" -d "$(stream_body 2222)" | id_of)
for i in $(seq 1 10); do
  curl -sS --max-time 5 http://nginxions:2222/ 2>/dev/null | grep -q '^Hostname:' && break
  [ "$i" = 10 ] && fail "the stream on 2222 does not answer"
  sleep 1
done
for port in 2222 2220-2230 443 81; do
  code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    "$ADMIN/api/nginx/streams" -d "$(stream_body $port)")
  [ "$code" = 400 ] || fail "a stream on the busy port $port: expected 400, got $code"
done
$CURL -X DELETE "$ADMIN/api/nginx/streams/$sid" > /dev/null

step "access lists: Basic Auth asks for the login, an IP list lets in the allowed address and refuses another"
acl_host() { # domain, list id
  new_json "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"$1\"], \"forward_scheme\": \"http\",
    \"forward_host\": \"test-upstream\", \"forward_port\": 80, \"npmplus_access_list_type\": \"custom\",
    \"npmplus_access_list_ids\": [$2]}" > /dev/null
}
basic_id=$(new_json "$ADMIN/api/nginx/access-lists" -d '{"name": "smoke basic", "satisfy_any": false, "pass_auth": false,
  "items": [{"username": "alice", "password": "wonderland1"}], "clients": []}' | id_of)
allow_id=$(new_json "$ADMIN/api/nginx/access-lists" -d "{\"name\": \"smoke allow\", \"satisfy_any\": false,
  \"pass_auth\": false, \"items\": [], \"clients\": [{\"address\": \"$client_ip\", \"directive\": \"allow\"},
  {\"address\": \"all\", \"directive\": \"deny\"}]}" | id_of)
deny_id=$(new_json "$ADMIN/api/nginx/access-lists" -d "{\"name\": \"smoke deny\", \"satisfy_any\": false,
  \"pass_auth\": false, \"items\": [], \"clients\": [{\"address\": \"$client_ip\", \"directive\": \"deny\"}]}" | id_of)
acl_host basic.local "$basic_id"; acl_host ip-allow.local "$allow_id"; acl_host ip-deny.local "$deny_id"
sleep 2
PATH_=/
want "$(host_code basic.local)" 401 "Basic Auth without a login"
curl -sS --max-time 10 -H 'Host: basic.local' "$HTTP/" | grep -q 'Sign-in required' \
  || fail "Basic Auth: the 401 is not the page of NginxionS"
want "$(host_code basic.local -u alice:wonderland1)" 200 "Basic Auth with the password"
want "$(host_code ip-allow.local)" 200 "IP list, the allowed address"
want "$(host_code ip-deny.local)" 403 "IP list, a refused address"
# a login without a password, a rule without an address: 400, not 500 (DAST, schemathesis)
for body in '{"name": "no password", "items": [{"username": "bob"}]}' \
  '{"name": "no address", "clients": [{"directive": "allow"}]}'; do
  code=$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    "$ADMIN/api/nginx/access-lists" -d "$body")
  [ "$code" = 400 ] || fail "access list $body: expected 400, got $code"
done

step "debugging methods: TRACK, DEBUG and TRACE get 405 on a host and on the interface (DAST: Proxy Disclosure)"
for m in TRACK DEBUG TRACE; do
  want "$(host_code basic.local -X $m -u alice:wonderland1)" 405 "$m on a host"
  code=$(curl -sS -k -o /dev/null -w '%{http_code}' --max-time 10 -X $m "$ADMIN/api/")
  [ "$code" = 405 ] || fail "$m on the interface: expected 405, got $code"
done
