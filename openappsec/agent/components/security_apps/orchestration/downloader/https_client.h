 

#ifndef __HTTPS_CLIENT_H__
#define __HTTPS_CLIENT_H__

#include <string>
#include "maybe_res.h"
#include "url_parser.h"
#include "orchestration_comp.h"

// LCOV_EXCL_START Reason: Depends on real download server.
class HTTPSClient
{
public:
    Maybe<void> getFile(const URLParser &url, const std::string &out_file, bool auth_required);
    Maybe<void> getFileSSLWithBody(const std::string &uri, const std::string &body, const std::string &out_file);

private:
    std::string loadCAChainDir();
    Maybe<void> getFileSSL(const URLParser &url, const std::string &out_file, const std::string &_token);
    Maybe<void> getFileSSLDirect(const URLParser &url, const std::string &out_file, const std::string &_token);
    Maybe<void> curlGetFileOverSSL(const URLParser &url, const std::string &out_file, const std::string &_token);
};
// LCOV_EXCL_STOP

#endif // __HTTPS_CLIENT_H__
