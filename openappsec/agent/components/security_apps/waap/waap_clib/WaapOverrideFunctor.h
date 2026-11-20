 

#pragma once

namespace Waap {
    namespace Util {
        struct CIDRData; // forward decleration
        struct RegexComparator;
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

private:
    Waf2Transaction &waf2Transaction;
};
