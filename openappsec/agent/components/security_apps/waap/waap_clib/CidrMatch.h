 

#pragma once
#include <string>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <errno.h>
#include <vector>

namespace Waap {
namespace Util {

struct CIDRData {
    std::string cidrString;
    struct in_addr ipCIDRV4;
    struct in6_addr ipCIDRV6;
    uint8_t networkBits;
    bool isIPV6;
    bool operator==(const CIDRData &other) const;
    bool operator<(const CIDRData &other) const;
};

bool isCIDR(const std::string& strCIDR, CIDRData& cidr);
bool cidrMatch(const std::string& sourceip, const CIDRData& cidr);
bool cidrMatch(const std::string &sourceip, const std::string &target);
bool doesFirstCidrContainSecond(const CIDRData &first, const CIDRData &second);
std::string cidrsToString(const std::vector<CIDRData>& cidrs);

}
}
