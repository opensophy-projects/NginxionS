# shellcheck shell=sh disable=SC2154  # sourced by the WAF smoke group

# Give each drop exception its own path so no other exception can produce its 403.
drop_exception() {
  post_json POST /objects "{\"kind\":\"exception\",\"name\":\"smoke-exception-$1\",\"spec\":{
    \"action\":\"drop\",\"condition\":[{\"key\":\"url\",\"value\":\"/smoke-exception-$1\"},$2]}}" | new_id
}

exception_status() (
  expected=$1 path=$2 description=$3
  shift 3
  for attempt in $(seq 1 60); do
    actual=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: test.local' "$@" "$HTTP$path" || true)
    [ "$actual" = "$expected" ] && return 0
    # Only retry a block while the new policy is loading. A 403 on a control is a failed assertion.
    [ "$expected" = 403 ] || break
    [ "$attempt" = 60 ] || sleep 2
  done
  fail "$description: expected $expected, got ${actual:-no response}"
)

method_header=$(drop_exception method-header '
  {"key":"method","value":"POST"},
  {"key":"headerName","value":"x-smoke-client"},
  {"key":"headerValue","value":"legacy-smoke-client"}')
method_in=$(drop_exception method-in '
  {"key":"method","op":"in","value":"POST"},
  {"key":"method","op":"in","value":"PUT"}')
method_not_equals=$(drop_exception method-not-equals '{"key":"method","op":"not-equals","value":"POST"}')
method_not_in=$(drop_exception method-not-in '
  {"key":"method","op":"not-in","value":"GET"},
  {"key":"method","op":"not-in","value":"POST"}')
in_query=$(drop_exception query '{"key":"paramLocation","value":"url_param"}')
in_body=$(drop_exception body '{"key":"paramLocation","value":"body"}')
# The XSS fixture in the WAF group emits this indicator. The SQLi fixture has different indicators.
with_indicator=$(drop_exception indicator '{"key":"indicator","value":"document[.]cookie"}')
any_indicator=$(drop_exception exist '{"key":"indicator","op":"exist"}')
for exception_id in "$method_header" "$method_in" "$method_not_equals" "$method_not_in" "$in_query" "$in_body" \
  "$with_indicator" "$any_indicator"; do
  [ -n "$exception_id" ] || fail "an x-nginxions exception could not be created"
done

step "WAF -> Policy: detect mode lets the fixture through before the x-nginxions drop exceptions"
host_objects null detect-learn
wait_status_stable "$XSS" 200 "the fixture should pass in detect mode before the drop exceptions"
sample="${XSS#/\?}"
other_sample="${SQLI#/\?}"
exception_status 200 "/smoke-exception-query?$sample" "query fixture in detect mode" -X POST
exception_status 200 /smoke-exception-body "body fixture in detect mode" --data "$sample"

host_objects "{\"exceptions\": [$method_header, $method_in, $method_not_equals, $method_not_in,
  $in_query, $in_body, $with_indicator, $any_indicator]}" detect-learn

step "WAF -> Policy: method, header name and header value must all match"
path=/smoke-exception-method-header
exception_status 403 "$path" "matching method and header" -X POST -H 'X-Smoke-Client: Legacy-Smoke-Client'
exception_status 200 "$path" "wrong method" -X GET -H 'X-Smoke-Client: Legacy-Smoke-Client'
exception_status 200 "$path" "wrong header value" -X POST -H 'X-Smoke-Client: current-smoke-client'
exception_status 200 "$path" "right value under the wrong name" -X POST -H 'X-Other-Client: legacy-smoke-client'
exception_status 200 /smoke-exception-control "same method and header on a different path" \
  -X POST -H 'X-Smoke-Client: legacy-smoke-client'

step "WAF -> Policy: in, not-equals and not-in match the right methods"
exception_status 403 /smoke-exception-method-in "first listed method" -X POST
exception_status 403 /smoke-exception-method-in "second listed method" -X PUT
exception_status 200 /smoke-exception-method-in "unlisted method" -X GET
exception_status 403 /smoke-exception-method-not-equals "different method" -X PUT
exception_status 200 /smoke-exception-method-not-equals "excluded method" -X POST
exception_status 403 /smoke-exception-method-not-in "method outside both exclusions" -X PUT
exception_status 200 /smoke-exception-method-not-in "first excluded method" -X GET
exception_status 200 /smoke-exception-method-not-in "second excluded method" -X POST

step "WAF -> Policy: paramLocation distinguishes the same field in the query and body"
exception_status 403 "/smoke-exception-query?$sample" "query field matches" -X POST
exception_status 200 /smoke-exception-query "body field does not match a query condition" --data "$sample"
exception_status 403 /smoke-exception-body "body field matches" --data "$sample"
exception_status 200 "/smoke-exception-body?$sample" "query field does not match a body condition" -X POST

step "WAF -> Policy: indicator matches the specified indicator and exist needs an indicator"
exception_status 403 "/smoke-exception-indicator?$sample" "specified indicator matches"
exception_status 200 "/smoke-exception-indicator?$other_sample" "different indicators do not match"
exception_status 403 "/smoke-exception-exist?$sample" "exist matches a request with indicators"
exception_status 200 '/smoke-exception-exist?q=hello' "exist does not match a request without indicators"

host_objects null
wait_status "$XSS" 403 "the original blocking policy should be restored after the exception tests"
