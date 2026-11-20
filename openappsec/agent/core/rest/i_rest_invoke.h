 

#ifndef __I_REST_INVOKE_H__
#define __I_REST_INVOKE_H__

#include <string>
#include <istream>
#include <map>

#include "maybe_res.h"

class I_RestInvoke
{
public:
    virtual Maybe<std::string> getSchema(const std::string &uri) const = 0;
    virtual Maybe<std::string> invokeRest(
        const std::string &uri,
        std::istream &in,
        const std::map<std::string, std::string> &headers
    ) const = 0;

    virtual bool isGetCall(const std::string &uri) const = 0;
    virtual std::string invokeGet(const std::string &uri) const = 0;

    virtual bool isPostCall(const std::string &uri) const = 0;
    virtual Maybe<std::string> invokePost(const std::string &uri, const std::string &body) const = 0;

    virtual bool shouldCaptureHeaders(const std::string &uri) const = 0;

protected:
    ~I_RestInvoke() {}
};

#endif // __I_REST_INVOKE_H__
