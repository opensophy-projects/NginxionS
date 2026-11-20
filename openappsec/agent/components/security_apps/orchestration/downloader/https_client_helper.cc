 

#include "https_client.h"

Maybe<void>
HTTPSClient::getFileSSLDirect(const URLParser &, const std::string &, const std::string &)
{
    return genError("No direct downloading in open-source");
}
