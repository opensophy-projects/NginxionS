 

#pragma once
#include <set>
#include <boost/regex.hpp>

namespace Waap {
namespace Util {

// Custom comparator for std::shared_ptr<boost::regex>
struct RegexComparator {
    bool operator()(const std::shared_ptr<boost::regex>& lhs, const std::shared_ptr<boost::regex>& rhs) const {
        // Compare the actual regex patterns by string representation
        return lhs->str() < rhs->str();
    }
};

std::string regexSetToString(const std::set<std::shared_ptr<boost::regex>, RegexComparator> &regexSet);

}
}
