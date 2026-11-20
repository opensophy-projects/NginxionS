 

#include "SecurityHeadersPolicy.h"
#include "Waf2Util.h"

namespace Waap {
namespace SecurityHeaders {

void
Policy::StrictTransportSecurity::buildInjectStr() {
    if (preload && includeSubDomains)
    {
        directivesStr = "max-age=" + maxAge + "; includeSubDomains; preload";
    }
    else if (includeSubDomains)
    {
        directivesStr = "max-age=" + maxAge + "; includeSubDomains";
    }
    else if (preload)
    {
        directivesStr = "max-age=" + maxAge + "; preload";
    }
    else
    {
        directivesStr = "max-age=" + maxAge;
    }
    headerDetails = std::make_pair(headerName, directivesStr);
}

void
Policy::XFrameOptions::buildInjectStr() {
    headerDetails = std::make_pair(headerName, directivesStr);
}

void
Policy::XContentTypeOptions::buildInjectStr() {
    headerDetails = std::make_pair(headerName, directivesStr);
}

bool
Policy::SecurityHeadersEnforcement::operator==(const Policy::SecurityHeadersEnforcement &other) const
{
    return enable == other.enable;
}

bool
Policy::XFrameOptions::operator==(const XFrameOptions &other) const
{
    return sameOrigin == other.sameOrigin && directivesStr == other.directivesStr &&
        deny == other.deny && headerName == other.headerName &&
        headerDetails.first == other.headerDetails.first  &&
        headerDetails.second == other.headerDetails.second;
}

bool
Policy::XContentTypeOptions::operator==(const XContentTypeOptions &other) const
{
    return directivesStr == other.directivesStr && headerName == other.headerName &&
        headerDetails.first == other.headerDetails.first  && headerDetails.second == other.headerDetails.second;
}

bool
Policy::StrictTransportSecurity::operator==(const StrictTransportSecurity &other) const
{
    return maxAge == other.maxAge && directivesStr == other.directivesStr &&
        includeSubDomains == other.includeSubDomains && headerName == other.headerName &&
        preload == other.preload && headerDetails.first == other.headerDetails.first  &&
        headerDetails.second == other.headerDetails.second;
}

bool
Policy::Headers::operator==(const Headers &other) const
{
    return other.headersInjectStr == headersInjectStr && hsts == other.hsts &&
        xContentTypeOptions == other.xContentTypeOptions && xFrameOptions == other.xFrameOptions;
}

bool
Policy::operator==(const Policy &other) const
{
    return headers == other.headers && m_securityHeaders == other.m_securityHeaders;
}

State::State(const std::shared_ptr<Policy> &policy)
{
    for(auto headerStr : policy->headers.headersInjectStr)
    {
        headersInjectStrs.push_back(headerStr);
    }
}

}
}
