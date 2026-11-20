 

#include "RegexComparator.h"
#include <sstream>

namespace Waap {
namespace Util {

std::string regexSetToString(const std::set<std::shared_ptr<boost::regex>, RegexComparator> &regexSet) {
    std::stringstream ss;
    ss << "[";
    bool first = true;
    for (const auto &regexPtr : regexSet) {
        if (!first) ss << ", ";
        if (regexPtr) {
            first = false;
            ss << regexPtr->str();
        }
    }
    ss << "]";
    return ss.str();
}

}
}
