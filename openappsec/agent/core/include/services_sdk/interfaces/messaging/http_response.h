 

#ifndef __HTTP_RESPONSE_H__
#define __HTTP_RESPONSE_H__

#include <string>
#include <map>
#include <cereal/archives/json.hpp>

#include "singleton.h"
#include "i_env_details.h"
#include "i_agent_details.h"
#include "i_encryptor.h"
#include "messaging/messaging_enums.h"

class HTTPResponse
{
public:
// LCOV_EXCL_START Reason: Not actually called but is required by the caching interface
    HTTPResponse() = default;
// LCOV_EXCL_STOP

    HTTPResponse(
        HTTPStatusCode _status_code,
        const std::string &_body,
        std::unordered_map<std::string, std::string> _headers = std::unordered_map<std::string, std::string>()
    )
            :
        status_code(_status_code),
        body(_body),
        headers(_headers)
    {}

    HTTPStatusCode getHTTPStatusCode() const;
    const std::string & getBody() const;
    std::string toString() const;
    Maybe<std::string> getHeaderVal(const std::string &header_key);

private:
    HTTPStatusCode status_code;
    std::string body;
    std::unordered_map<std::string, std::string> headers;
};

#endif // __HTTP_RESPONSE_H__
