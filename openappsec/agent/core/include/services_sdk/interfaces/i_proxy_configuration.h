 

#ifndef __I_PROXY_CONFIGURATION_H__
#define __I_PROXY_CONFIGURATION_H__

#include <string>

#include "maybe_res.h"

enum class ProxyProtocol
{
    HTTP,
    HTTPS
};

class I_ProxyConfiguration
{
public:
    virtual Maybe<std::string> getProxyDomain(ProxyProtocol protocol)         const = 0;
    virtual Maybe<std::string> getProxyAuthentication(ProxyProtocol protocol) const = 0;
    virtual Maybe<uint16_t> getProxyPort(ProxyProtocol protocol)              const = 0;
    virtual bool getProxyExists(ProxyProtocol protocol)                       const = 0;
    virtual Maybe<std::string> getProxyAddress(ProxyProtocol protocol)        const = 0;
    virtual Maybe<void> loadProxy()                                                 = 0;
};

#endif // __I_PROXY_CONFIGURATION_H__
