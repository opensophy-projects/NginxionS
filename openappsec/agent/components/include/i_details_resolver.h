 

#ifndef __I_DETAILS_RESOLVER_H__
#define __I_DETAILS_RESOLVER_H__

#include "maybe_res.h"

#include <string>

class I_DetailsResolver
{
public:
    virtual Maybe<std::string> getHostname() = 0;
    virtual Maybe<std::string> getPlatform() = 0;
    virtual Maybe<std::string> getArch() = 0;
    virtual std::string getAgentVersion() = 0;
    virtual bool isKernelVersion3OrHigher() = 0;
    virtual bool isGw() = 0;
    virtual bool isGwNotVsx() = 0;
    virtual bool isVersionAboveR8110() = 0;
    virtual bool isReverseProxy() = 0;
    virtual bool isCloudStorageEnabled() = 0;
    virtual Maybe<std::tuple<std::string, std::string, std::string, std::string>> parseNginxMetadata() = 0;
    virtual Maybe<std::tuple<std::string, std::string, std::string, std::string, std::string>> readCloudMetadata() = 0;
    virtual std::map<std::string, std::string> getResolvedDetails() = 0;
#if defined(gaia) || defined(smb)
    virtual bool compareCheckpointVersion(int cp_version, std::function<bool(int, int)> compare_operator) const = 0;
#endif // gaia || smb

protected:
    virtual ~I_DetailsResolver() {}
};

#endif // __I_DETAILS_RESOLVER_H__
