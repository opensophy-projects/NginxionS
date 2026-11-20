 

#ifndef __SCAN_RESULT_H__
#define __SCAN_RESULT_H__

#include "Waf2Util.h"
#include <string>
#include <vector>
#include <set>


struct Waf2ScanResult {
    std::vector<std::string> keyword_matches;
    std::vector<std::string> regex_matches;
    std::vector<std::string> filtered_keywords;
    Waap::Util::map_of_stringlists_t found_patterns;
    std::string unescaped_line;
    std::string param_name;
    std::string location;
    double score;
    double other_model_score;
    double scoreNoFilter;
    std::vector<double> scoreArray;
    std::vector<double> coefArray;
    std::vector<std::string> keywordCombinations;
    std::vector<std::string> keywordsAfterFilter;
    std::set<std::string> attack_types;
    bool m_isAttackInParam;
    void clear(); // clear Waf2ScanResult
    Waf2ScanResult();
    void mergeFrom(const Waf2ScanResult& other);
};

#endif // __SCAN_RESULT_H__
