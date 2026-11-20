 

#pragma once
#include "WaapOpenRedirectPolicy.h"
#include <set>
#include <string>
#include <memory>
#include "debug.h"

namespace Waap {
namespace OpenRedirect {

class State {
public:
    void collect(const char* v, size_t v_len, const std::string &hostStr);
    bool testRedirect(const std::string &redirectUrl) const;
    bool empty() const;
private:
    std::set<std::string> m_openRedirectUrls;
};

}
}
