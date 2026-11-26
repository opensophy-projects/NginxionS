/*
 * Copyright 2009-2010 Cybozu Labs, Inc.
 * Copyright 2011-2014 Kazuho Oku
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
#include <curl/curl.h>
#include <limits>
#include "../picojson.h"

// NginxionS: propagate buffer allocation failures to libcurl without letting an exception cross its callback.
static size_t append_response(char *ptr, size_t size, size_t count, void *stream) {
  if (size != 0 && count > std::numeric_limits<size_t>::max() / size)
    return 0;
  const size_t bytes = size * count;
  try {
    static_cast<std::string *>(stream)->append(ptr, bytes);
  } catch (const std::exception &) {
    return 0;
  }
  return bytes;
}

int main() {
  char error[CURL_ERROR_SIZE] = {};
  std::string response;

  CURL *curl = curl_easy_init();
  if (!curl) {
    std::cerr << "Could not initialize curl" << std::endl;
    return 1;
  }
  curl_easy_setopt(curl, CURLOPT_URL, "https://api.github.com/repos/kazuho/picojson/issues");
  // NginxionS: keep libcurl's default TLS verification for the API.
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "curl");
  curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, error);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, append_response);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
  const CURLcode result = curl_easy_perform(curl);
  curl_easy_cleanup(curl);
  if (result != CURLE_OK) {
    std::cerr << (error[0] ? error : curl_easy_strerror(result)) << std::endl;
    return 1;
  }

  picojson::value v;
  const std::string err = picojson::parse(v, response);
  if (!err.empty() || !v.is<picojson::array>()) {
    std::cerr << (err.empty() ? "Expected a JSON array from GitHub" : err) << std::endl;
    return 1;
  }
  const picojson::array &issues = v.get<picojson::array>();
  for (picojson::array::const_iterator it = issues.begin(); it != issues.end(); it++) {
    if (!it->is<picojson::object>())
      continue;
    picojson::object obj = it->get<picojson::object>();
    std::cout << "#" << obj["number"].to_str() << ": " << obj["title"].to_str() << std::endl;
    std::cout << "  " << obj["html_url"].to_str() << std::endl << std::endl;
  }

  return 0;
}
