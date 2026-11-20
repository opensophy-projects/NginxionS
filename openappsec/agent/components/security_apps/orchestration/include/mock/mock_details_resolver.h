 

#ifndef __MOCK_DETAILS_RESOLVER_H__
#define __MOCK_DETAILS_RESOLVER_H__

#include <iostream>

#include "i_details_resolver.h"
#include "cptest.h"
#include "maybe_res.h"

std::ostream &
operator<<(std::ostream &os, const Maybe<std::tuple<std::string, std::string, std::string, std::string>> &)
{
    return os;
}

std::ostream &
operator<<(
    std::ostream &os, const Maybe<std::tuple<std::string, std::string, std::string, std::string, std::string>> &)
{
    return os;
}

class MockDetailsResolver
        :
    public Singleton::Provide<I_DetailsResolver>::From<MockProvider<I_DetailsResolver>>
{
public:
    MOCK_METHOD0(getHostname,                Maybe<std::string>());
    MOCK_METHOD0(getPlatform,                Maybe<std::string>());
    MOCK_METHOD0(getArch,                    Maybe<std::string>());
    MOCK_METHOD0(getAgentVersion,            std::string());
    MOCK_METHOD0(isCloudStorageEnabled,      bool());
    MOCK_METHOD0(isReverseProxy,             bool());
    MOCK_METHOD0(isKernelVersion3OrHigher,   bool());
    MOCK_METHOD0(isGw,                       bool());
    MOCK_METHOD0(isGwNotVsx,                 bool());
    MOCK_METHOD0(getResolvedDetails,         std::map<std::string, std::string>());
    MOCK_METHOD0(isVersionAboveR8110,        bool());
    MOCK_METHOD0(parseNginxMetadata,         Maybe<std::tuple<std::string, std::string, std::string, std::string>>());
    MOCK_METHOD0(
        readCloudMetadata, Maybe<std::tuple<std::string, std::string, std::string, std::string, std::string>>());
};

#endif // __MOCK_DETAILS_RESOLVER_H__
