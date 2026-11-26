 

#pragma once

#include <utility>

namespace Waap {
    namespace Util {
        struct CIDRData; // forward decleration
        struct RegexComparator;
    }
    namespace Override {
        class Match;
    }
}

class Waf2Transaction;

// Functor used to match Override rules against request data
class WaapOverrideFunctor {
public:
    WaapOverrideFunctor(Waf2Transaction &waf2Transaction);

    bool operator()(const std::string &tag, const std::vector<Waap::Util::CIDRData> &values);

    bool operator()(
        const std::string &tag,
        const std::set<std::shared_ptr<boost::regex>, Waap::Util::RegexComparator> &rxes
    );

    bool matchSameHeader(const Waap::Override::Match &conditions) const;

private:
    Waf2Transaction &waf2Transaction;
    const std::pair<std::string, std::string> *current_header = nullptr;
};
