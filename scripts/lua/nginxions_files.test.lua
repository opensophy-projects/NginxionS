-- Tests of nginxions_files.lua (File Security of the WAF policy) with LuaJIT and a stand-in of nginx: the verdicts of
-- clamd, the severity and confidence of a signature, archives, documents of Office, files with no name, threat
-- emulation. Run by scripts/test-lua.sh (CI, fast checks).
local root = arg[1] or "nginxions/rootfs/usr/local/lua/nginxions"
package.path = root .. "/?.lua;" .. package.path
package.loaded["cjson.safe"] = {
  decode = function() return nil end,
  encode = function(t)
    local parts = {}
    for k, v in pairs(t) do parts[#parts + 1] = k .. "=" .. tostring(v) end
    table.sort(parts)
    return table.concat(parts, " ")
  end,
}

local exited, logged, reply, body
ngx = {
  var = {}, HTTP_FORBIDDEN = 403, ERR = 1,
  log = function() end,
  utctime = function() return "2026-11-14 10:00:00" end,
  exit = function(code) exited = code end,
  req = {
    get_method = function() return "POST" end,
    read_body = function() end,
    get_body_data = function() return body end,
    get_body_file = function() return nil end,
  },
  socket = { tcp = function()
    return {
      settimeouts = function() end, connect = function() return true end,
      send = function() return true end, receive = function() return reply end, close = function() end,
    }
  end },
}
local open = io.open
io.open = function(name, mode)
  if name:match("files%-security") then return nil end
  if name:match("nginxions%-files%.log") then
    return { setvbuf = function() end, write = function(_, l) logged = l end }
  end
  return open(name, mode)
end

local M = require "nginxions_files"

-- the rules of the host, set where check() reads them (the upvalue conf)
local function set_rules(rules)
  local i = 1
  while true do
    local name = debug.getupvalue(M.check, i)
    if not name then return end
    if name == "conf" then debug.setupvalue(M.check, i, { hosts = { ["1"] = rules } }) end
    i = i + 1
  end
end

local function run(rule, data, verdict, vars)
  exited, logged, body, reply = nil, nil, data, verdict and ("stream: " .. verdict .. "\0") or nil
  ngx.var = vars or { uri = "/up", request_uri = "/up", content_type = "application/octet-stream" }
  ngx.var.nginxions_files_host = "1"
  set_rules({ rule })
  M.check()
  return exited, logged
end

local function copy(t, o)
  local r = {}
  for k, v in pairs(t) do r[k] = v end
  for k, v in pairs(o or {}) do r[k] = v end
  return r
end

local base = {
  mode = "prevent", actions = { high = "prevent", medium = "prevent", low = "detect" }, max_bytes = 1e7,
  large_action = "prevent", min_severity = "medium", unnamed_action = "inactive",
  archives = { extract = false, max_bytes = 1e7, nested_action = "prevent", failed_action = "prevent" },
}
local named = { uri = "/up/a.bin", request_uri = "/up/a.bin", content_type = "application/octet-stream" }
local zip_with = function(name)
  return "PK\3\4" .. string.rep("\0", 22) .. string.char(#name, 0, 0, 0) .. name .. "PK\3\4"
end

local tests = {
  { "a virus is refused", function() return run(base, "x", "Win.Test.EICAR_HDB-1 FOUND", named) == 403 end },
  { "a clean file passes", function() return run(base, "x", "OK", named) == nil end },
  { "detect logs and lets through", function()
    local e, l = run(copy(base, { mode = "detect", actions = { high = "detect", medium = "detect", low = "detect" } }),
      "x", "Win.Test.EICAR_HDB-1 FOUND", named)
    return e == nil and l and l:find("action=detect") ~= nil
  end },
  { "PUA is below the medium severity", function() return run(base, "x", "PUA.Win.Tool.X FOUND", named) == nil end },
  { "a trojan is below critical", function()
    return run(copy(base, { min_severity = "critical" }), "x", "Win.Trojan.X FOUND", named) == nil
  end },
  { "ransomware is critical", function()
    return run(copy(base, { min_severity = "critical" }), "x", "Win.Ransomware.X FOUND", named) == 403
  end },
  { "an unnamed binary upload follows unnamedFilesAction", function()
    return run(copy(base, { unnamed_action = "prevent" }), "x", "OK") == 403
  end },
  { "a name in the path is a name", function()
    return run(copy(base, { unnamed_action = "prevent" }), "x", "OK", named) == nil
  end },
  { "JSON is not a file", function()
    return run(copy(base, { unnamed_action = "prevent" }), "{}", "OK", { uri = "/up", content_type = "application/json" }) == nil
  end },
  { "a multipart part with a filename is named", function()
    local mp = "--b\r\nContent-Disposition: form-data; name=\"f\"; filename=\"a.pdf\"\r\nContent-Type: application/pdf\r\n\r\nzz\r\n"
      .. "--b\r\nContent-Disposition: form-data; name=\"t\"\r\n\r\nv\r\n--b--\r\n"
    return run(copy(base, { unnamed_action = "prevent" }), mp, "OK",
      { uri = "/up", content_type = "multipart/form-data; boundary=b" }) == nil
  end },
  { "a multipart part of a type with no filename is unnamed", function()
    local mp = "--b\r\nContent-Disposition: form-data; name=\"f\"\r\nContent-Type: application/pdf\r\n\r\nzz\r\n--b--\r\n"
    return run(copy(base, { unnamed_action = "prevent" }), mp, "OK",
      { uri = "/up", content_type = "multipart/form-data; boundary=b" }) == 403
  end },
  { "an archive is not opened without extractArchiveFiles", function()
    return run(base, zip_with("a.txt"), "Win.Trojan.X FOUND", named) == nil
  end },
  { "an archive inside a zip follows its action", function()
    local ex = copy(base, { archives = { extract = true, max_bytes = 1e7, nested_action = "prevent", failed_action = "detect" } })
    return run(ex, zip_with("a.zip"), "OK", named) == 403
  end },
  { "an extracted archive is scanned", function()
    local ex = copy(base, { archives = { extract = true, max_bytes = 1e7, nested_action = "prevent", failed_action = "detect" } })
    return run(ex, zip_with("a.txt"), "Win.Trojan.X FOUND", named) == 403
  end },
  { "an encrypted archive follows the action of a failed extraction", function()
    local ex = copy(base, { archives = { extract = true, max_bytes = 1e7, nested_action = "prevent", failed_action = "detect" } })
    local e, l = run(ex, zip_with("a.txt"), "Heuristics.Encrypted.Zip FOUND", named)
    return e == nil and l and l:find("action=detect") ~= nil
  end },
  { "a document of Office is scanned with archives off", function()
    return run(base, zip_with("[Content_Types].xml"), "Doc.Trojan.X FOUND", named) == 403
  end },
  { "macros count only with threat emulation", function()
    return run(base, "x", "Heuristics.OLE2.ContainsMacros FOUND", named) == nil
      and run(copy(base, { deep = true }), "x", "Heuristics.OLE2.ContainsMacros FOUND", named) == 403
  end },
  { "every partition heuristic of clamd is threat emulation", function()
    local deep = copy(base, { deep = true })
    return run(deep, "x", "Heuristics.GPTPartitionIntersection FOUND", named) == 403
      and run(deep, "x", "Heuristics.APMPartitionIntersection FOUND", named) == 403
      and run(deep, "x", "Heuristics.MBRPartitionnIntersect FOUND", named) == 403
      and run(base, "x", "Heuristics.GPTPartitionIntersection FOUND", named) == nil
  end },
  { "clamd down lets the upload through (fail-open)", function() return run(base, "x", nil, named) == nil end },
  { "a GET is not checked", function()
    ngx.req.get_method = function() return "GET" end
    local ok = run(base, "x", "Win.Test.EICAR_HDB-1 FOUND", named) == nil
    ngx.req.get_method = function() return "POST" end
    return ok
  end },
  -- fuzzing (docs/DEVSECOPS.md): bodies of uploads are the input of the internet. Mutated multipart bodies, archives
  -- and answers of clamd must give a verdict (nothing or 403), never an error of Lua (an error 500 in nginx).
  -- FUZZ_ITERATIONS cases (300 in CI, more at night), FUZZ_SEED replays one.
  { "fuzz: random uploads and answers of clamd give a verdict, never an error of Lua", function()
    local n = tonumber(os.getenv("FUZZ_ITERATIONS") or "") or 300
    local seed = tonumber(os.getenv("FUZZ_SEED") or "") or os.time()
    math.randomseed(seed)
    local seeds = {
      "--b\r\nContent-Disposition: form-data; name=\"f\"; filename=\"a.pdf\"\r\nContent-Type: application/pdf\r\n\r\nzz\r\n--b--\r\n",
      "--b\r\nContent-Disposition: form-data; name=\"f\"\r\n\r\nzz\r\n--b--\r\n",
      zip_with("a.zip"), zip_with("[Content_Types].xml"), zip_with("mimetype"), "PK\5\6" .. string.rep("\0", 18), "x",
    }
    local tokens = { "\r\n", "--b", "--", "PK\3\4", "PK\1\2", "\0", "\255", "filename=", "\"", ";", string.rep("A", 300) }
    local replies = { "OK", "Win.Test.EICAR_HDB-1 FOUND", "Heuristics.Encrypted.Zip FOUND", "Heuristics.Limits.Exceeded FOUND",
      "INSTREAM size limit exceeded. ERROR", "garbage", "", " FOUND", nil }
    local types = { "multipart/form-data; boundary=b", "multipart/form-data", "multipart/form-data; boundary=",
      "application/octet-stream", "application/zip", "text/plain" }
    local function mutate(s)
      for _ = 1, math.random(1, 6) do
        local at = math.random(0, #s)
        local op = math.random(1, 4)
        if op == 1 then s = s:sub(1, at) .. string.char(math.random(0, 255)) .. s:sub(at + 2)
        elseif op == 2 then s = s:sub(1, at) .. s:sub(at + 1 + math.random(1, 8))
        elseif op == 3 then s = s:sub(1, at) .. tokens[math.random(#tokens)] .. s:sub(at + 1)
        else s = s:sub(1, at) end
      end
      return s
    end
    for i = 1, n do
      local data = mutate(seeds[math.random(#seeds)])
      local rule = copy(base, {
        unnamed_action = ({ "inactive", "detect", "prevent" })[math.random(3)],
        deep = math.random() < 0.5,
        archives = { extract = math.random() < 0.5, max_bytes = math.random(0, 64), nested_action = "prevent", failed_action = "detect" },
      })
      local vars = { uri = "/up", request_uri = "/up", content_type = types[math.random(#types)] }
      local ok, e = pcall(run, rule, data, replies[math.random(#replies + 1)], vars)
      if not ok or (e ~= nil and e ~= 403) then
        error(string.format("case %d (FUZZ_SEED=%d): %s; body %q", i, seed, tostring(e), data:sub(1, 200)))
      end
    end
    return true
  end },
}

local failed = 0
for _, t in ipairs(tests) do
  local ok, res = pcall(t[2])
  if ok and res then
    print("ok - " .. t[1])
  else
    failed = failed + 1
    print("not ok - " .. t[1] .. (ok and "" or (": " .. tostring(res))))
  end
end
print(string.format("%d tests, %d failed", #tests, failed))
os.exit(failed == 0 and 0 or 1)
