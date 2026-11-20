 

#pragma once

#include "Waf2Util.h"
#include <vector>
#include <unordered_set>
#include <string>

namespace Waap {
namespace Keywords {

typedef std::unordered_set<std::string> KeywordsSet;
typedef std::vector<std::string> KeywordsVec;

void computeKeywordsSet(KeywordsSet &keywordsSet, const std::vector<std::string> &keyword_matches,
    const Waap::Util::map_of_stringlists_t &found_patterns);

}
}
