# shellcheck shell=sh disable=SC2154  # variables and helpers of deploy/test/smoke.sh, which sources it
# Smoke group «certs» (deploy/test/smoke.sh runs it in a subshell of its own): every operation of Certificates, end to
# end through the API, with what the user then sees and what nginx serves. ACME servers (presets with their own
# address, your own, the default one), certificates of your own (upload, use by a host, refusals, deletion), the CAs of
# the PKI (create, rename, export, import, delete with and without cascade), templates and settings, the certificates
# of the PKI (notes, files, one-time links, renewal, revocation, deletion), mTLS of a host (switch, change, off and on,
# with the host deleted), the refusals of mTLS as one event per page load, the address of one-time links.

ensure_analyst

# names of this run: a stack kept between runs (KEEP=1) has those of the last one
R=$(date +%s | tail -c 6)

json_id() { tr -d ' \n' | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*$'; }
json_pem() { tr -d '\n' | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | awk '{ gsub(/\\n/, "\n"); printf "%s", $0 }' > "$2"; }
# the HTTP code of a request of the administrator (the body in /tmp/certs-answer)
code_of() { curl -sS -k -b "$JAR" -o /tmp/certs-answer -w '%{http_code}' -H 'Content-Type: application/json' "$@"; }
answer() { cat /tmp/certs-answer; }
# a code that is not the expected one is shown with the answer of the server
expect() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1: $(tr -d '\n' < /tmp/certs-answer 2> /dev/null | head -c 400)"; }
# the file of an answer {filename, content_type, data_base64} (exports and downloads)
answer_file() { tr -d ' \n' < /tmp/certs-answer | sed -n 's/.*"data_base64":"\([^"]*\)".*/\1/p' | base64 -d > "$1"; }
# a certificate of the PKI in GET /pki (its subject and SANs are objects of their own)
cert_json() { $CURL "$ADMIN/api/nginxions/pki" | json | grep -o "{\"id\":$1,\"created_on\":[^{]*{[^}]*},\"sans\":{[^}]*}[^}]*" | head -1; }
# the TLS certificate nginx serves for a name: its subject and issuer
served() { curl -sS -k -v --max-time 10 --connect-to "$1:443:nginxions:443" "https://$1/" -o /dev/null 2>&1 | grep -E '^\* +(subject|issuer):'; }

# ---------------------------------------------------------------- ACME servers

step "ACME: the presets and the default server are listed"
servers=$($CURL "$ADMIN/api/nginxions/acme/servers" | json)
echo "$servers" | grep -q '"id":"tlscc-stage"' || fail "the preset of TCI is not listed: $servers"
echo "$servers" | grep -q '"name":"ТЦИ,tlscc.ru(stage)"' || fail "the preset of TCI has the old name: $servers"
default_id=$(echo "$servers" | grep -o '"items":\[{"id":[0-9]*' | grep -o '[0-9]*$')
[ -n "$default_id" ] || fail "no ACME server: $servers"

step "ACME: the address of a preset can be changed and is kept"
expect "$(code_of "$ADMIN/api/nginxions/acme/servers" -d '{"preset": "tlscc-stage", "client": "lego",
  "directory": "https://acme.moved.example/directory"}')" 200 "a preset with its own address"
tci_id=$(answer | json_id)
answer | json | grep -q '"directory":"https://acme.moved.example/directory"' || fail "the address is not kept: $(answer)"
answer | json | grep -q '"preset":"tlscc-stage"' || fail "the server is no longer of the preset: $(answer)"
# a change of the name only keeps the address
expect "$(code_of -X PUT "$ADMIN/api/nginxions/acme/servers/$tci_id" -d '{"name": "TCI (moved)"}')" 200 "rename"
answer | json | grep -q '"directory":"https://acme.moved.example/directory"' || fail "renamed, the address is lost: $(answer)"
answer | json | grep -q '"name":"TCI(moved)"' || fail "the name is not changed: $(answer)"
# back to the address of the preset
expect "$(code_of -X PUT "$ADMIN/api/nginxions/acme/servers/$tci_id" \
  -d '{"directory": "https://acme.stage.tlscc.ru/directory"}')" 200 "the address of the preset again"
answer | json | grep -q '"directory":"https://acme.stage.tlscc.ru/directory"' || fail "not back: $(answer)"

step "ACME: refusals: a bad address, certbot where only lego works, EAB half given, an analyst"
expect "$(code_of "$ADMIN/api/nginxions/acme/servers" -d '{"directory": "javascript:alert(1)"}')" 400 "a bad address"
expect "$(code_of "$ADMIN/api/nginxions/acme/servers" -d '{"preset": "tlscc-stage", "client": "certbot"}')" 400 \
  "certbot for TCI"
expect "$(code_of "$ADMIN/api/nginxions/acme/servers" -d '{"directory": "https://ca.internal/dir", "eab_kid": "kid"}')" \
  400 "EAB without its HMAC key"
expect "$(as_analyst -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/acme/servers" \
  -d '{"directory": "https://ca.internal/dir"}')" 403 "analyst adds an ACME server"

step "ACME: the default server moves, the default one cannot be removed, another one can"
expect "$(code_of -X POST "$ADMIN/api/nginxions/acme/servers/$tci_id/default")" 200 "make TCI the default"
$CURL "$ADMIN/api/nginxions/acme/servers" | json | grep -q "{\"id\":$tci_id,[^}]*\"is_default\":true" \
  || fail "TCI is not the default one: $($CURL "$ADMIN/api/nginxions/acme/servers")"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/acme/servers/$tci_id")" 400 "remove the default server"
expect "$(code_of -X POST "$ADMIN/api/nginxions/acme/servers/$default_id/default")" 200 "the first one default again"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/acme/servers/$tci_id")" 200 "remove TCI"
$CURL "$ADMIN/api/nginxions/acme/servers" | json | grep -q "{\"id\":$tci_id," && fail "TCI is still listed"

# ---------------------------------------------------------------- the CAs of the PKI

step "PKI: a root and trust domains; a name or a subject taken twice is refused"
root_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/cas" \
  -d "{\"kind\": \"root\", \"name\": \"Certs Root $R\", \"subject\": {\"common_name\": \"Certs Root $R\"}}" | json_id)
[ -n "$root_id" ] || fail "root CA was not created"
office_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\",
  \"name\": \"Certs Office $R\", \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Certs Office $R\"}}" | json_id)
[ -n "$office_id" ] || fail "trust domain was not created"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\", \"name\": \"Certs Office $R\",
  \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Certs Office 2 $R\"}}")" 400 "a second CA of the same name"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\", \"name\": \"Certs Office 2 $R\",
  \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Certs Office $R\"}}")" 400 "a second CA of the same subject"
twin_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/cas" -d "{\"kind\": \"intermediate\",
  \"name\": \"Certs Draft $R\", \"parent_id\": $root_id, \"subject\": {\"common_name\": \"Certs Partners $R\"}}" | json_id)
[ -n "$twin_id" ] || fail "the second trust domain was not created"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas" -d '{"kind": "intermediate", "name": "orphan",
  "subject": {"common_name": "orphan"}}')" 400 "a trust domain without its root"

step "PKI: a CA is renamed; the root exports its certificate and CRL, its key only with a password"
expect "$(code_of -X PUT "$ADMIN/api/nginxions/pki/cas/$twin_id" -d "{\"name\": \"Certs Partners $R\"}")" 200 "rename a CA"
$CURL "$ADMIN/api/nginxions/pki/cas/$twin_id" | json | grep -q "\"name\":\"CertsPartners$R\"" || fail "the CA is not renamed"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/$root_id/export" -d '{"format": "cert"}')" 200 "export of the root"
answer_file /tmp/certs-root.crt
grep -q 'BEGIN CERTIFICATE' /tmp/certs-root.crt || fail "the export of the root has no certificate: $(answer | head -c 300)"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/$office_id/export" -d '{"format": "crl"}')" 200 "CRL of the trust domain"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/$root_id/export" -d '{"format": "key"}')" 400 "the key without a password"
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/$root_id/export" -d '{"format": "key", "password": "Smoke-key-1"}')" \
  200 "the key with a password"
answer_file /tmp/certs-root.key
grep -q 'ENCRYPTED PRIVATE KEY' /tmp/certs-root.key || fail "the exported key is not encrypted: $(head -c 100 /tmp/certs-root.key)"
expect "$(as_analyst -X POST -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/cas/$root_id/export" \
  -d '{"format": "key", "password": "Smoke-key-1"}')" 403 "analyst exports the key of the root"

step "PKI: an external CA is imported by its certificate and deleted"
cert_pem=$(awk '{ printf "%s\\n", $0 }' /tmp/certs-root.crt)
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/import" -d "{\"kind\": \"external\", \"name\": \"Certs External $R\",
  \"cert_pem\": \"$cert_pem\"}")" 201 "import of an external CA"
external_id=$(answer | json_id)
expect "$(code_of "$ADMIN/api/nginxions/pki/cas/import" -d '{"kind": "external", "name": "broken",
  "cert_pem": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"}')" 400 "import of a broken certificate"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/pki/cas/$external_id")" 200 "delete the external CA"
$CURL "$ADMIN/api/nginxions/pki" | json | grep -q "{\"id\":$external_id,\"name\"" && fail "the external CA is still listed"

# ---------------------------------------------------------------- templates and settings

step "PKI: a template is saved, issues a certificate with its values and is removed"
settings=$($CURL "$ADMIN/api/nginxions/pki" | json | sed -n 's/.*"settings":\({[^}]*"templates":\[[^]]*\][^}]*}\).*/\1/p')
[ -n "$settings" ] || fail "no settings of the PKI"
put_settings() { # templates JSON, public_url
  code_of -X PUT "$ADMIN/api/nginxions/pki/settings" -d "{\"public_url\": \"$2\", \"crl_days\": 7, \"client_days\": 365,
    \"server_days\": 397, \"key_type\": \"ec-p256\", \"p12_compatible\": false, \"templates\": $1}"
}
expect "$(put_settings "[{\"id\": \"vpn\", \"name\": \"VPN\", \"profile\": \"client\", \"ca_id\": $office_id, \"days\": 30,
  \"key_type\": \"ec-p384\", \"subject\": {\"organizational_unit\": \"VPN\"}}]" "")" 200 "save a template"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id, \"profile\": \"client\", \"template\": \"vpn\",
  \"subject\": {\"common_name\": \"templated\"}}")" 201 "issue with the template"
templated=$(answer | json)
echo "$templated" | grep -q '"key_type":"ec-p384"' || fail "the template key type is not used: $templated"
echo "$templated" | grep -q 'OU=VPN\|"organizational_unit":"VPN"' || fail "the template subject is not used: $templated"
templated_id=$(echo "$templated" | json_id)
expect "$(put_settings "[{\"id\": \"bad\", \"name\": \"Bad\", \"profile\": \"client\", \"ca_id\": $office_id, \"days\": 30,
  \"key_type\": \"rsa-1\"}]" "")" 400 "a template with a key type that does not exist"
expect "$(put_settings '[]' "https://pki.certs.test")" 200 "remove the template, set a public address"
$CURL "$ADMIN/api/nginxions/pki" | json | grep -q '"public_url":"https://pki.certs.test"' || fail "the public address is not saved"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id, \"profile\": \"client\", \"template\": \"vpn\",
  \"subject\": {\"common_name\": \"no-template\"}}")" 400 "issue with a removed template"
expect "$(put_settings '[]' "")" 200 "no public address"

# ---------------------------------------------------------------- certificates of the PKI

step "PKI: a client certificate: notes, files, a one-time link and its deletion"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id, \"profile\": \"client\", \"store_key\": true,
  \"subject\": {\"common_name\": \"erin\"}, \"notes\": \"laptop\"}")" 201 "issue erin"
erin_id=$(answer | json_id)
expect "$(code_of -X PUT "$ADMIN/api/nginxions/pki/certs/$erin_id" -d '{"notes": "laptop, room 4"}')" 200 "change the notes"
cert_json "$erin_id" | grep -q '"notes":"laptop,room4"' || fail "the notes are not changed: $(cert_json "$erin_id")"
for format in cert chain key; do
  expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$erin_id/download" -d "{\"format\": \"$format\"}")" 200 "download $format"
done
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$erin_id/download" -d '{"format": "p12", "password": "Erin-p12-pass"}')" \
  200 "download .p12 with a password"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$erin_id/download" -d '{"format": "exe"}')" 400 "download in a format that does not exist"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$erin_id/links" -d '{"hours": 2}')" 201 "a one-time link"
link=$(answer | json)
link_path=$(echo "$link" | grep -o '"path":"[^"]*"' | cut -d'"' -f4)
[ -n "$link_path" ] || fail "the link has no address: $link"
link_id=$($CURL "$ADMIN/api/nginxions/pki/certs/$erin_id/links" | json_id)
[ -n "$link_id" ] || fail "the link is not listed: $($CURL "$ADMIN/api/nginxions/pki/certs/$erin_id/links")"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/pki/links/$link_id")" 200 "delete the link"
expect "$(curl -sS -k -o /dev/null -w '%{http_code}' "$ADMIN$link_path")" 410 "a deleted link opens"
# a certificate without a kept key has no link and no key to download
expect "$(code_of "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id, \"profile\": \"client\",
  \"subject\": {\"common_name\": \"frank\"}}")" 201 "issue frank without keeping the key"
frank_id=$(answer | json_id)
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$frank_id/download" -d '{"format": "key"}')" 400 "the key that is not kept"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$frank_id/links" -d '{"hours": 2}')" 400 "a link without the key"
expect "$(as_analyst -X PUT -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/certs/$erin_id" \
  -d '{"notes": "x"}')" 403 "analyst changes the notes"

step "PKI: renewal with the old one revoked, revocation, deletion"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/$erin_id/renew" -d '{"revoke_old": true, "store_key": true}')" 201 "renew erin"
erin2_id=$(answer | json_id)
[ "$erin2_id" != "$erin_id" ] || fail "the renewal is the same certificate"
cert_json "$erin_id" | grep -q '"status":"revoked"' || fail "the old certificate of erin is not revoked: $(cert_json "$erin_id")"
cert_json "$erin2_id" | grep -q '"status":"active"' || fail "the new certificate of erin is not active: $(cert_json "$erin2_id")"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/revoke" -d "{\"ids\": [$frank_id], \"reason\": \"keyCompromise\"}")" 200 "revoke frank"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/revoke" -d "{\"ids\": [$frank_id], \"reason\": \"no-such-reason\"}")" 400 \
  "revoke with a reason that does not exist"
expect "$(code_of "$ADMIN/api/nginxions/pki/certs/delete" -d "{\"ids\": [$erin_id, $erin2_id, $frank_id, $templated_id]}")" \
  200 "delete them"
for id in $erin_id $erin2_id $frank_id $templated_id; do
  [ -z "$(cert_json "$id")" ] || fail "certificate $id is still listed"
done

# ---------------------------------------------------------------- certificates of your own

step "Certificates: a certificate of your own is checked, uploaded, served by a host"
server=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id,
  \"profile\": \"server\", \"subject\": {\"common_name\": \"own-$R.certs.test\"}, \"sans\": {\"dns\": [\"own-$R.certs.test\"]},
  \"include_key_pem\": true}")
echo "$server" | json_pem cert_pem /tmp/own.crt
echo "$server" | json_pem key_pem /tmp/own.key
grep -q 'BEGIN' /tmp/own.key || fail "no key of the server certificate: $server"
other=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id,
  \"profile\": \"server\", \"subject\": {\"common_name\": \"other-$R.certs.test\"}, \"sans\": {\"dns\": [\"other-$R.certs.test\"]},
  \"include_key_pem\": true}")
echo "$other" | json_pem key_pem /tmp/other.key
$CURL -F certificate=@/tmp/own.crt -F certificate_key=@/tmp/own.key "$ADMIN/api/nginx/certificates/validate" | json \
  | grep -q '"certificate":{' || fail "the certificate does not validate"
expect "$(curl -sS -k -b "$JAR" -o /tmp/certs-answer -w '%{http_code}' -F certificate=@/tmp/own.crt \
  -F certificate_key=@/tmp/other.key "$ADMIN/api/nginx/certificates/validate")" 400 "a key of another certificate"
own_id=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/certificates" \
  -d "{\"provider\": \"other\", \"nice_name\": \"Certs own $R\"}" | json_id)
[ -n "$own_id" ] || fail "the certificate of your own was not created"
$CURL -F certificate=@/tmp/own.crt -F certificate_key=@/tmp/own.key "$ADMIN/api/nginx/certificates/$own_id/upload" > /dev/null \
  || fail "the files were not uploaded"
own_host=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"own-$R.certs.test\"],
  \"forward_scheme\": \"http\", \"forward_host\": \"test-upstream\", \"forward_port\": \"80\", \"certificate_id\": $own_id}" | json_id)
[ -n "$own_host" ] || fail "the host of the certificate was not created"
for i in $(seq 1 15); do
  served own-$R.certs.test | grep -q "CN=own-$R.certs.test" && break
  [ "$i" = 15 ] && fail "nginx does not serve the certificate: $(served own-$R.certs.test)"
  sleep 2
done
registry=$($CURL "$ADMIN/api/nginxions/certificates?q=own-$R.certs.test" | json)
echo "$registry" | grep -q "\"name\":\"Certsown$R\"" || fail "the registry does not list it: $registry"
echo "$registry" | grep -q '"used_by":\[{' || fail "the registry does not say which host uses it: $registry"

step "Certificates: the built-in self-signed certificate is listed as used by the panel"
$CURL "$ADMIN/api/nginxions/certificates?source=file" | json | grep -q '"kind":"dummy"' || fail "no built-in certificate"

step "Certificates: a certificate of your own is deleted with its host gone, nginx stays up"
expect "$(code_of -X DELETE "$ADMIN/api/nginx/proxy-hosts/$own_host")" 200 "delete the host"
expect "$(code_of -X DELETE "$ADMIN/api/nginx/certificates/$own_id")" 200 "delete the certificate"
$CURL "$ADMIN/api/nginxions/certificates?q=own-$R.certs.test" | json | grep -q "\"name\":\"Certsown$R\"" \
  && fail "a deleted certificate is listed"
wait_status / 200 "nginx does not answer after the deletion of a certificate"

# ---------------------------------------------------------------- mTLS of a host

step "mTLS: a host is switched on in one step, changed, switched off and on again with its settings"
mhost=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"m-$R.certs.test\"],
  \"forward_scheme\": \"http\", \"forward_host\": \"test-upstream\", \"forward_port\": \"80\", \"certificate_id\": $(
  $CURL -H 'Content-Type: application/json' "$ADMIN/api/nginxions/pki/certs" -d "{\"ca_id\": $office_id,
  \"profile\": \"server\", \"subject\": {\"common_name\": \"m-$R.certs.test\"}, \"sans\": {\"dns\": [\"m-$R.certs.test\"]},
  \"install\": true}" | json | grep -o '"certificate_id":[0-9]*' | grep -o '[0-9]*$')}" | json_id)
[ -n "$mhost" ] || fail "the host m-$R.certs.test was not created"
expect "$(code_of -X POST "$ADMIN/api/nginxions/mtls/proxy_host/$mhost/enable")" 200 "switch mTLS on"
mtls_now() { $CURL "$ADMIN/api/nginxions/mtls/proxy_host/$mhost" | json; }
mtls_now | grep -q '"enabled":true' || fail "mTLS is not on: $(mtls_now)"
cas=$(mtls_now | grep -o '"ca_ids":\[[0-9,]*\]' | head -1)
expect "$(code_of -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$mhost" -d "{\"enabled\": true, $cas, \"mode\": \"optional\",
  \"denied_page\": \"not_found\", \"headers\": false, \"required_paths\": [\"/\"]}")" 200 "change mTLS"
expect "$(code_of -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$mhost" -d "{\"enabled\": true, $cas, \"mode\": \"optional\",
  \"required_paths\": [\"/admin\"]}")" 400 "a required path that is not a location of the host"
answer | grep -q 'only locations of the host' || fail "the refusal does not say why: $(answer)"
expect "$(code_of -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$mhost" -d "{\"enabled\": true, \"ca_ids\": [], \"mode\": \"on\"}")" 400 \
  "mTLS on without a CA"
expect "$(code_of -X PUT "$ADMIN/api/nginxions/mtls/proxy_host/$mhost" -d '{"enabled": false}')" 200 "switch off (the other fields kept)"
mtls_now | grep -q '"enabled":false' || fail "mTLS is not off"
mtls_now | grep -q '"denied_page":"not_found"' || fail "switched off, the settings are lost: $(mtls_now)"
expect "$(code_of -X POST "$ADMIN/api/nginxions/mtls/proxy_host/$mhost/enable")" 200 "switch on again"
mtls_now | grep -q '"mode":"optional"' || fail "switched on again, the settings are lost: $(mtls_now)"
expect "$(as_analyst -X POST "$ADMIN/api/nginxions/mtls/proxy_host/$mhost/enable")" 403 "analyst switches mTLS"

step "mTLS: a page loaded without a certificate is one event with the number of its requests"
# the host requires a certificate on / (mode optional, required path /): the page, its script and its API calls
mreq() { curl -sS -k --max-time 10 --connect-to "m-$R.certs.test:443:nginxions:443" -o /dev/null -w '%{http_code}' \
  "https://m-$R.certs.test$1"; }
for i in $(seq 1 15); do
  [ "$(mreq /)" = 404 ] && break
  [ "$i" = 15 ] && fail "the host does not refuse a request without a certificate: $(mreq /)"
  sleep 2
done
for path in /app.js /api/one /api/two /favicon.ico; do mreq "$path" > /dev/null; done
events_of_host() { $CURL "$ADMIN/api/nginxions/events?kind=mtls&limit=20&q=m-$R.certs.test" | json; }
for i in $(seq 1 20); do
  events_of_host | grep -q '"repeats":[2-9]' && break
  [ "$i" = 20 ] && fail "the refusals are not counted in one event: $(events_of_host | head -c 1500)"
  sleep 2
done
count=$(events_of_host | grep -o '"kind":"mtls"' | wc -l)
[ "$count" -le 2 ] || fail "one page load is $count events: $(events_of_host | head -c 1500)"

step "mTLS: a host that is deleted takes its mTLS with it"
expect "$(code_of -X DELETE "$ADMIN/api/nginx/proxy-hosts/$mhost")" 200 "delete the host"
expect "$(code_of "$ADMIN/api/nginxions/mtls/proxy_host/$mhost")" 404 "mTLS of a deleted host"
$CURL "$ADMIN/api/nginxions/mtls" | json | grep -q "\"host_id\":$mhost," && fail "a deleted host is still protected"

step "PKI: one-time links lead to the domain of the panel when it has one"
panel=$($CURL -H 'Content-Type: application/json' "$ADMIN/api/nginx/proxy-hosts" -d "{\"domain_names\": [\"panel-$R.certs.test\"],
  \"forward_scheme\": \"https\", \"forward_host\": \"127.0.0.1\", \"forward_port\": \"81\"}" | json_id)
[ -n "$panel" ] || fail "the host of the panel was not created"
$CURL "$ADMIN/api/nginxions/pki" | json | grep -q "\"panel_urls\":\[[^]]*{\"url\":\"http://panel-$R.certs.test\",\"mtls\":false}" \
  || fail "the domain of the panel is not offered: $($CURL "$ADMIN/api/nginxions/pki" | json | grep -o '"panel_urls":[^]]*]')"
expect "$(code_of -X DELETE "$ADMIN/api/nginx/proxy-hosts/$panel")" 200 "delete the host of the panel"

step "PKI: a root with trust domains is deleted only with them (cascade)"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/pki/cas/$root_id")" 400 "delete a root that has trust domains"
expect "$(code_of -X DELETE "$ADMIN/api/nginxions/pki/cas/$root_id?cascade=true&disable_hosts=true")" 200 "delete it in cascade"
for id in $root_id $office_id $twin_id; do
  expect "$(code_of "$ADMIN/api/nginxions/pki/cas/$id")" 404 "CA $id after the cascade"
done
