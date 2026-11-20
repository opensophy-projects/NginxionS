# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «pki» (deploy/test/smoke.sh runs it in a subshell of its own): PKI and mTLS: CAs, certificates, revocation (CRL, OCSP), short-lived certificates, streams, cascade.

ensure_analyst


# the first number "id" of a JSON answer
json_id() { tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*$'; }
# a PEM field of a JSON answer as a file
json_pem() { tr -d '\n' | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | awk '{ gsub(/\\n/, "\n"); printf "%s", $0 }' > "$2"; }
api_json() { $CURL -H 'Content-Type: application/json' "$@"; }
HTTPS_MTLS="https://mtls.local"
TLS_TO="--connect-to mtls.local:443:nginxions:443"

step "PKI: a root CA and a trust domain"
root_id=$(api_json "$ADMIN/api/nginxions/pki/cas" \
  -d '{"kind": "root", "name": "Smoke Root", "subject": {"common_name": "Smoke Root", "organization": "NginxionS"}}' | json_id)
[ -n "$root_id" ] || fail "root CA was not created"
domain_id=$(api_json "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\", \"name\": \"Smoke Office\",
  \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Smoke Office\", \"organization\": \"NginxionS\"}}" | json_id)
[ -n "$domain_id" ] || fail "trust domain was not created"
other_id=$(api_json "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\", \"name\": \"Smoke Partners\",
  \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Smoke Partners\", \"organization\": \"NginxionS\"}}" | json_id)
expect "$(as_analyst -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/cas" \
  -d '{"kind": "root", "name": "x", "subject": {"common_name": "x"}}')" 403 "analyst creates a CA"

step "PKI: a server certificate of the trust domain becomes a certificate of NPMplus"
server=$(api_json "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $domain_id, \"profile\": \"server\",
  \"subject\": {\"common_name\": \"mtls.local\"}, \"sans\": {\"dns\": [\"mtls.local\"]}, \"install\": true}")
tls_id=$(echo "$server" | tr -d ' \n' | grep -o '"certificate_id":[0-9]*' | grep -o '[0-9]*$')
[ -n "$tls_id" ] || fail "server certificate was not installed: $server"
host_id=$(api_json "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"mtls.local\"], \"forward_scheme\": \"http\",
  \"forward_host\": \"test-upstream\", \"forward_port\": \"80\", \"certificate_id\": $tls_id}" | json_id)
[ -n "$host_id" ] || fail "proxy host mtls.local was not created"

step "mTLS: the host requires a certificate of the trust domain with OU=IT"
api_json -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$host_id" -d "{\"enabled\": true, \"ca_ids\": [$domain_id],
  \"rules\": [{\"field\": \"organizational_unit\", \"op\": \"one_of\", \"values\": [\"IT\"]}]}" \
  | tr -d ' \n' | grep -q '"nginx_online":true' || fail "nginx did not take the mTLS of the host"

# a client certificate as PEM files (the tester has no openssl to open a .p12)
client() { # name, OU, CA id → /tmp/<name>.crt, /tmp/<name>.key
  answer=$(api_json "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $3, \"profile\": \"client\",
    \"subject\": {\"common_name\": \"$1\", \"organizational_unit\": \"$2\"}, \"include_key_pem\": true, \"link_hours\": 1}")
  echo "$answer" | json_pem cert_pem "/tmp/$1.crt"
  echo "$answer" | json_pem key_pem "/tmp/$1.key"
  grep -q 'BEGIN CERTIFICATE' "/tmp/$1.crt" || fail "no certificate for $1: $answer"
  echo "$answer"
}
alice=$(client alice IT "$domain_id")
client bob Sales "$domain_id" > /dev/null
client carol IT "$other_id" > /dev/null
mtls() { curl -sS -k --max-time 10 $TLS_TO -o /dev/null -w '%{http_code}' "$@" "$HTTPS_MTLS/"; }

for i in $(seq 1 15); do
  [ "$(mtls --cert /tmp/alice.crt --key /tmp/alice.key)" = 200 ] && break
  [ "$i" = 15 ] && fail "the host does not let alice in"
  sleep 2
done
body=$(curl -sS -k --max-time 10 $TLS_TO --cert /tmp/alice.crt --key /tmp/alice.key -H 'X-Client-Verify: FAKE' "$HTTPS_MTLS/")
echo "$body" | grep -q '^X-Client-Verify: SUCCESS' || fail "the upstream did not get X-Client-Verify: $body"
echo "$body" | grep -q '^X-Client-S-Dn: CN=alice,OU=IT' || fail "the upstream did not get the subject: $body"
echo "$body" | grep -q 'FAKE' && fail "a spoofed X-Client-Verify reached the upstream"
expect "$(mtls)" 403 "no client certificate"

step "mTLS: the refused request is a security event"
for i in $(seq 1 15); do
  $CURL "$ADMIN/api/nginxions/events?kind=mtls&limit=5" | grep -q '"name": *"mTLS: no client certificate"' && break
  [ "$i" = 15 ] && fail "no mTLS event: $($CURL "$ADMIN/api/nginxions/events?kind=mtls&limit=5")"
  sleep 2
done
curl -sS -k --max-time 10 $TLS_TO "$HTTPS_MTLS/" | grep -q 'client certificate is required' \
  || fail "no explanation page without a certificate"
expect "$(mtls --cert /tmp/bob.crt --key /tmp/bob.key)" 403 "a certificate with OU=Sales"
expect "$(mtls --cert /tmp/carol.crt --key /tmp/carol.key)" 403 "a certificate of another trust domain"

step "PKI: the one-time link opens once, the CRL is published"
link=$(echo "$alice" | tr -d ' \n' | grep -o '"path":"[^"]*"' | cut -d'"' -f4)
[ -n "$link" ] || fail "no one-time link"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' "$ADMIN$link")" 200 "the one-time link"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' "$ADMIN$link")" 410 "the one-time link again"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' "$ADMIN/api/nginxions/pki/public/crl/$domain_id.crl")" 200 "the CRL"

step "PKI: a revoked certificate is refused within a minute"
alice_id=$(echo "$alice" | tr -d ' \n' | grep -o '"certificate":{"id":[0-9]*' | grep -o '[0-9]*$')
api_json "$ADMIN/api/nginxions/pki/certs/revoke" -d "{\"ids\": [$alice_id], \"reason\": \"keyCompromise\"}" \
  | grep -q '"revoked": *1' || fail "alice was not revoked"
for i in $(seq 1 30); do
  [ "$(mtls --cert /tmp/alice.crt --key /tmp/alice.key)" = 403 ] && break
  [ "$i" = 30 ] && fail "the revoked certificate still opens the host after a minute"
  sleep 2
done

step "mTLS: revocation by OCSP refuses a revoked certificate within a minute and a half, nginx is not reloaded"
api_json -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$host_id" -d "{\"enabled\": true, \"ca_ids\": [$domain_id],
  \"rules\": [{\"field\": \"organizational_unit\", \"op\": \"one_of\", \"values\": [\"IT\"]}], \"revocation\": \"ocsp\"}" \
  | tr -d ' \n' | grep -q '"revocation":"ocsp"' || fail "the host did not take revocation by OCSP"
erin=$(client erin IT "$domain_id")
for i in $(seq 1 15); do
  [ "$(mtls --cert /tmp/erin.crt --key /tmp/erin.key)" = 200 ] && break
  [ "$i" = 15 ] && fail "OCSP: the host does not let erin in"
  sleep 2
done
erin_id=$(echo "$erin" | tr -d ' \n' | grep -o '"certificate":{"id":[0-9]*' | grep -o '[0-9]*$')
api_json "$ADMIN/api/nginxions/pki/certs/revoke" -d "{\"ids\": [$erin_id], \"reason\": \"keyCompromise\"}" \
  | grep -q '"revoked": *1' || fail "erin was not revoked"
for i in $(seq 1 45); do
  [ "$(mtls --cert /tmp/erin.crt --key /tmp/erin.key)" = 403 ] && break
  [ "$i" = 45 ] && fail "OCSP: the revoked certificate still opens the host"
  sleep 2
done

step "PKI: a service renews its short-lived certificate with its token, the token works once"
svc=$(api_json "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $domain_id, \"profile\": \"client\",
  \"subject\": {\"common_name\": \"smoke-svc\"}, \"auto_renew\": \"token\", \"hours\": 2}" | tr -d ' \n')
svc_token=$(echo "$svc" | grep -o '"renew_token":"[^"]*"' | cut -d'"' -f4)
[ -n "$svc_token" ] || fail "no renewal token: $svc"
renewed=$(curl -sS -k --max-time 30 -X POST "$ADMIN/api/nginxions/pki/public/renew" -H "Authorization: Bearer $svc_token" \
  -H 'Content-Type: application/json' -d '{}' | tr -d ' \n')
echo "$renewed" | grep -q 'BEGINCERTIFICATE' || fail "the service was not renewed: $renewed"
echo "$renewed" | grep -q '"renew_token":"[^"]' || fail "no new token after the renewal: $renewed"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -X POST "$ADMIN/api/nginxions/pki/public/renew" \
  -H "Authorization: Bearer $svc_token" -H 'Content-Type: application/json' -d '{}')" 401 "the used renewal token"

step "mTLS in one step: the switch of a host creates its trust domain, an access certificate opens it"
quick_id=$(api_json "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"quick.local\"], \"forward_scheme\": \"http\",
  \"forward_host\": \"test-upstream\", \"forward_port\": \"80\", \"certificate_id\": $tls_id}" | json_id)
[ -n "$quick_id" ] || fail "proxy host quick.local was not created"
quick=$(api_json -X POST "$ADMIN/api/nginxions/mtls/proxy_host/$quick_id/enable" | tr -d ' \n')
echo "$quick" | grep -q '"enabled":true' || fail "mTLS was not turned on: $quick"
quick_ca=$(echo "$quick" | grep -o '"ca_ids":\[[0-9]*' | grep -o '[0-9]*$')
$CURL "$ADMIN/api/nginxions/pki/cas/$quick_ca" | grep -q '"host": *"proxy_host-'"$quick_id"'"' \
  || fail "the trust domain of quick.local is not its own"
dana=$(client dana IT "$quick_ca")
quick_mtls() { curl -sS -k --max-time 10 --connect-to quick.local:443:nginxions:443 -o /dev/null -w '%{http_code}' "$@" https://quick.local/; }
for i in $(seq 1 15); do
  [ "$(quick_mtls --cert /tmp/dana.crt --key /tmp/dana.key)" = 200 ] && break
  [ "$i" = 15 ] && fail "the access certificate does not open quick.local"
  sleep 2
done
expect "$(quick_mtls)" 403 "quick.local without a certificate"
expect "$(quick_mtls --cert /tmp/carol.crt --key /tmp/carol.key)" 403 "quick.local with a certificate of another domain"
expect "$(mtls --cert /tmp/dana.crt --key /tmp/dana.key)" 403 "mtls.local with the access certificate of quick.local"
# dana is the only certificate of the trust domain of quick.local
$CURL "$ADMIN/api/nginxions/pki" | tr -d ' \n' | grep -q '{"host_type":"proxy_host","host_id":'"$quick_id"',"name":"quick.local"}' \
  || fail "the certificate does not list quick.local as what it opens"

step "mTLS: a deleted access certificate is revoked and gone from the list"
dana_id=$(echo "$dana" | tr -d ' \n' | grep -o '"certificate":{"id":[0-9]*' | grep -o '[0-9]*$')
api_json "$ADMIN/api/nginxions/pki/certs/delete" -d "{\"ids\": [$dana_id]}" | tr -d ' \n' \
  | grep -q '"deleted":1,"revoked":1' || fail "dana was not deleted"
for i in $(seq 1 30); do
  [ "$(quick_mtls --cert /tmp/dana.crt --key /tmp/dana.key)" = 403 ] && break
  [ "$i" = 30 ] && fail "the deleted certificate still opens quick.local"
  sleep 2
done
$CURL "$ADMIN/api/nginxions/pki" | grep -q '"common_name": *"dana"' && fail "the deleted certificate is still listed"

step "mTLS: a refused client gets the page the host chose (404, no answer), a valid certificate still passes"
denied() { # page → the mTLS of mtls.local with that page
  api_json -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$host_id" -d "{\"enabled\": true, \"ca_ids\": [$domain_id],
    \"rules\": [{\"field\": \"organizational_unit\", \"op\": \"one_of\", \"values\": [\"IT\"]}], \"revocation\": \"ocsp\",
    \"denied_page\": \"$1\"}" | tr -d ' \n' | grep -q "\"denied_page\":\"$1\"" || fail "mtls.local did not take the page $1"
}
# after a change old nginx workers still answer for a moment (graceful reload, reuseport): each check is repeated
eventually() { # description, command... → fails after 15 tries
  what=$1; shift
  for i in $(seq 1 15); do "$@" && return 0; [ "$i" = 15 ] && fail "$what"; sleep 1; done
}
mtls_code() { want=$1; shift; [ "$(mtls "$@" 2>/dev/null)" = "$want" ]; }
page_404() { curl -s -k --max-time 10 $TLS_TO "$HTTPS_MTLS/" | grep -q 'This site is not here'; }
denied not_found
eventually "no certificate: expected 404" mtls_code 404
eventually "the 404 page of NginxionS was not shown" page_404
eventually "a certificate refused by a rule: expected 404" mtls_code 404 --cert /tmp/bob.crt --key /tmp/bob.key
denied close
eventually "no certificate: expected no answer" mtls_code 000
eventually "a certificate of another host: expected no answer" mtls_code 000 --cert /tmp/dana.crt --key /tmp/dana.key
denied certificate
eventually "no certificate: expected 403 again" mtls_code 403

step "mTLS on a TCP stream: a certificate of the trust domain passes, none or a revoked one is refused"
stream_id=$(api_json "$ADMIN/api/nginx/streams" -d "{\"incoming_port\": 9555, \"forwarding_host\": \"test-upstream\",
  \"forwarding_port\": 80, \"tcp_forwarding\": true, \"udp_forwarding\": false, \"certificate_id\": $tls_id}" | json_id)
[ -n "$stream_id" ] || fail "the TLS stream :9555 was not created"
api_json -X PUT "$ADMIN/api/nginxions/mtls/stream/$stream_id" -d "{\"enabled\": true, \"ca_ids\": [$domain_id]}" \
  | tr -d ' \n' | grep -q '"enabled":true' || fail "the stream did not take mTLS"
expect "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -b $JAR -k \
  "$ADMIN/api/nginxions/mtls/stream/$stream_id" -d "{\"enabled\": true, \"ca_ids\": [$domain_id], \"revocation\": \"ocsp\"}")" \
  400 "OCSP on a stream"
stream_tls() { curl -s -k --max-time 10 -o /dev/null -w '%{http_code}' "$@" https://nginxions:9555/; }
gwen=$(client gwen IT "$domain_id")
for i in $(seq 1 15); do
  [ "$(stream_tls --cert /tmp/gwen.crt --key /tmp/gwen.key)" = 200 ] && break
  [ "$i" = 15 ] && fail "the stream does not let gwen in"
  sleep 2
done
expect "$(stream_tls)" 000 "the stream without a certificate"
expect "$(stream_tls --cert /tmp/carol.crt --key /tmp/carol.key)" 000 "the stream with a certificate of another domain"
gwen_id=$(echo "$gwen" | tr -d ' \n' | grep -o '"certificate":{"id":[0-9]*' | grep -o '[0-9]*$')
api_json "$ADMIN/api/nginxions/pki/certs/revoke" -d "{\"ids\": [$gwen_id], \"reason\": \"keyCompromise\"}" \
  | grep -q '"revoked": *1' || fail "gwen was not revoked"
for i in $(seq 1 30); do
  [ "$(stream_tls --cert /tmp/gwen.crt --key /tmp/gwen.key)" = 000 ] && break
  [ "$i" = 30 ] && fail "the revoked certificate still opens the stream"
  sleep 2
done
$CURL -X DELETE "$ADMIN/api/nginx/streams/$stream_id" > /dev/null

step "PKI: a revoked trust domain takes its certificates with it and issues nothing more"
api_json "$ADMIN/api/nginxions/pki/cas/$other_id/revoke" -d '{"reason": "keyCompromise"}' | tr -d ' \n' \
  | grep -q '"revoke_reason":"keyCompromise"' || fail "the trust domain Smoke Partners was not revoked"
carol_reason=$($CURL "$ADMIN/api/nginxions/pki" | tr -d ' \n' | sed -n 's/.*"common_name":"carol",\(.*\)/\1/p' \
  | grep -o '"revoke_reason":[^,]*' | head -1)
expect "$carol_reason" '"revoke_reason":"CACompromise"' "the certificate of carol revoked with its CA"
expect "$(curl -sS -k -b $JAR -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $other_id, \"profile\": \"client\", \"subject\": {\"common_name\": \"x\"}}")" \
  400 "issuing with a revoked CA"

step "Certificates: the registry lists the TLS certificate and the CAs of the PKI, without the deleted one"
registry=$($CURL "$ADMIN/api/nginxions/certificates?limit=200" | tr -d ' \n')
echo "$registry" | grep -q '"source":"tls"' || fail "no TLS certificate in the registry: $registry"
echo "$registry" | grep -q '"name":"SmokeOffice"' || fail "no trust domain in the registry: $registry"
echo "$registry" | grep -q '"name":"dana"' && fail "the deleted certificate is in the registry"
$CURL "$ADMIN/api/nginxions/certificates?source=pki&status=revoked&q=alice" | grep -q '"name": *"alice"' \
  || fail "the revoked certificate is not found by its status"

step "Audit log: pages from the server and the action filter"
audit=$($CURL "$ADMIN/api/nginxions/audit?action=revoked&limit=1" | tr -d ' \n')
echo "$audit" | grep -q '"action":"revoked"' || fail "no revoked entry in the audit log: $audit"
echo "$audit" | grep -q '"total":[1-9]' || fail "the audit log has no total: $audit"

step "PKI: a root with a trust domain and a certificate is deleted together with them (cascade)"
cascade_root=$(api_json "$ADMIN/api/nginxions/pki/cas" \
  -d '{"kind": "root", "name": "Smoke Cascade", "subject": {"common_name": "Smoke Cascade"}}' | json_id)
cascade_domain=$(api_json "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\", \"name\": \"Smoke Cascade Domain\",
  \"parent_id\": $cascade_root, \"subject\": {\"common_name\": \"Smoke Cascade Domain\"}}" | json_id)
[ -n "$cascade_domain" ] || fail "the cascade trust domain was not created"
api_json "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $cascade_domain, \"profile\": \"client\",
  \"subject\": {\"common_name\": \"cascade\"}}" > /dev/null
expect "$(curl -sS -k -b "$JAR" -o /dev/null -w '%{http_code}' -X DELETE "$ADMIN/api/nginxions/pki/cas/$cascade_root")" 400 \
  "a root with a trust domain deleted without cascade"
$CURL -X DELETE "$ADMIN/api/nginxions/pki/cas/$cascade_root?cascade=true" | grep -q true || fail "cascade delete failed"
if $CURL "$ADMIN/api/nginxions/pki" | grep -q 'Smoke Cascade'; then fail "the cascade left a CA behind"; fi

step "PKI: deleting the trust domain of a host turns its mTLS off and leaves no copy of the CA behind"
$CURL -X DELETE "$ADMIN/api/nginxions/pki/cas/$quick_ca?cascade=true&disable_hosts=true" | grep -q true \
  || fail "the trust domain of quick.local was not deleted"
$CURL "$ADMIN/api/nginxions/mtls/proxy_host/$quick_id" | tr -d ' \n' | grep -q '"enabled":false' \
  || fail "mTLS of quick.local is still on"
if $CURL "$ADMIN/api/nginxions/certificates?limit=200" | grep -q "proxy_host-$quick_id\.ca\.pem"; then
  fail "the CA file of quick.local is left in the registry"
fi

# ------------------------------------------------- servers of NginxionS (docs/adr/0012-nodes.md, phase 15)
step "Nodes: this server joins itself as a node with a one-time code (CSR, PKI, token, heartbeat), then is disabled"
node_answer=$(api_json -X POST "$ADMIN/api/nginxions/nodes" -d '{"name": "smoke-node", "labels": ["smoke"]}' | json)
node_id=$(echo "$node_answer" | grep -o '"node":{"id":[0-9]*' | grep -o '[0-9]*$')
node_code=$(echo "$node_answer" | grep -o '"code":"n-[0-9a-f]*\.[A-Za-z0-9_-]*"' | cut -d'"' -f4)
[ -n "$node_id" ] && [ -n "$node_code" ] || fail "no node or join code: $node_answer"
expect "$(as_analyst -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/nodes" -d '{"name": "x"}')" 403 \
  "analyst adds a node"
# without login: a code that is not ours is refused
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST \
  "$ADMIN/api/nginxions/nodes/register" -d '{"code": "n-0000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "csr_pem": "x"}')" \
  401 "register with an unknown code"
# the backend of this server calls its own panel as its manager (the certificate of the panel is pinned)
member=$(api_json -X PUT "$ADMIN/api/nginxions/cluster/member" \
  -d "{\"manager_url\": \"https://127.0.0.1:81\", \"code\": \"$node_code\"}" | json)
echo "$member" | grep -q '"joined":true' || fail "this server did not join itself: $member"
echo "$member" | grep -q '"fingerprint":"[0-9A-F:]\{95\}"' || fail "no pinned fingerprint of the manager: $member"
$CURL "$ADMIN/api/nginxions/nodes" | json | grep -q "\"id\":$node_id,[^}]*\"status\":\"active\"" \
  || fail "the node is not active: $($CURL "$ADMIN/api/nginxions/nodes" | json)"
$CURL "$ADMIN/api/nginxions/pki" | json | grep -q '"name":"NginxionSNodes"' \
  || fail "no trust domain of the nodes in the PKI"
# the code worked once
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST \
  "$ADMIN/api/nginxions/nodes/register" -d "{\"code\": \"$node_code\", \"csr_pem\": \"x\"}")" 401 "the join code used again"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer nt_wrong' \
  "$ADMIN/api/nginxions/nodes/heartbeat")" 401 "a heartbeat with a wrong token"
$CURL -X POST "$ADMIN/api/nginxions/nodes/$node_id/revoke" | json | grep -q '"state":"revoked"' || fail "the node was not disabled"
# its next heartbeat (every 30 s) learns it was disabled
disabled=""
for _ in $(seq 1 25); do
  $CURL "$ADMIN/api/nginxions/cluster/member" | json | grep -q '"disabled":true' && { disabled=1; break; }
  sleep 2
done
[ -n "$disabled" ] || fail "the node did not learn it was disabled: $($CURL "$ADMIN/api/nginxions/cluster/member" | json)"
$CURL -X DELETE "$ADMIN/api/nginxions/cluster/member" | json | grep -q '"joined":false' || fail "leaving the manager failed"
$CURL -X DELETE "$ADMIN/api/nginxions/nodes/$node_id" | grep -q true || fail "the disabled node was not deleted"
