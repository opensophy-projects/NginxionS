 

#ifndef __GENERIC_RULEBASE_UTILS_H__
#define __GENERIC_RULEBASE_UTILS_H__

#include <string>

#include "debug.h"
#include "cereal/archives/json.hpp"

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

template <typename T>
void
parseJSONKey(const std::string &key_name, T &value, cereal::JSONInputArchive &archive_in)
{
    try {
        archive_in(cereal::make_nvp(key_name, value));
    } catch (const cereal::Exception &e) {
        dbgDebug(D_RULEBASE_CONFIG)
            << "Could not parse the required key. Key: "
            << key_name
            << ", Error: "
            << e.what();
    }
}

#endif //__GENERIC_RULEBASE_UTILS_H__
