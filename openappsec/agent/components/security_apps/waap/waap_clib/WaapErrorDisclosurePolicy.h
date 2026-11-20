 

#pragma once
#include <cereal/types/string.hpp>
#include <string>
#include <memory>
#include <boost/algorithm/string/case_conv.hpp>
#include "debug.h"

namespace Waap {
namespace ErrorDisclosure {

struct Policy {
    template <typename _A>
    Policy(_A &ar)
    :
    enable(false),
    enforce(false)
    {
        bool web_attack_on;
        ar(cereal::make_nvp("webAttackMitigation", web_attack_on));
        if (!web_attack_on) return;

        std::string level;
        ar(cereal::make_nvp("errorDisclosure", level));
        level = boost::algorithm::to_lower_copy(level);
        if (level == "detect") {
            enable = true;
        }
        else if (level == "prevent") {
            enable = true;
            enforce = true;
        }
    }

    bool operator==(const Policy &other) const;

    bool enable;
    bool enforce;
};

}
}
