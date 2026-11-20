 

#pragma once
#include <string>
#include "../waap_clib/WaapKeywords.h"
#include "i_serialize.h"
#include <unordered_set>
#include <vector>

class IWaf2Transaction;

class I_IndicatorsFilter{
public:
    virtual ~I_IndicatorsFilter() { }

    // filters indicators from keywords vector
    virtual void filterKeywords(
        const std::string &key,
        Waap::Keywords::KeywordsSet& keywords,
        Waap::Keywords::KeywordsVec& filteredKeywords) = 0;

    // register keyword for a specific key
    virtual void registerKeywords(const std::string& key, Waap::Keywords::KeywordsSet& keyword,
        IWaf2Transaction* pTransaction) = 0;

    // returns true if the keyword based on the key should be filtered out
    virtual bool shouldFilterKeyword(const std::string &key, const std::string &keyword) const = 0;
};
