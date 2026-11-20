 

#ifndef __INTELLIGENCE_FILTER_H__
#define __INTELLIGENCE_FILTER_H__

#include "rest.h"
#include "common.h"
#include "intelligence_is/intelligence_types.h"

class IntelligenceFilter
{
public:
    IntelligenceFilter(
        const std::string &key,
        const std::string &value,
        Intelligence_IS::AttributeKeyType type= Intelligence_IS::AttributeKeyType::NONE
    );

    void addFilter(
        const std::string &key,
        const std::string &value,
        Intelligence_IS::AttributeKeyType type= Intelligence_IS::AttributeKeyType::NONE
    );

    std::string getQuery(bool is_encoded = true) const;
    const std::set<std::pair<std::string, std::string>> & getFilters() const;

    void addRequestedAttr(
        const std::string &attr,
        Intelligence_IS::AttributeKeyType type = Intelligence_IS::AttributeKeyType::NONE
    );

    const std::set<std::string> & getRequestedAttr() const;
    std::string getRequestedAttrStr() const;

private:
    std::string
    createAttrString(
        const std::string &value,
        bool use_quotes,
        Intelligence_IS::AttributeKeyType type = Intelligence_IS::AttributeKeyType::NONE
    ) const;

    std::set<std::pair<std::string, std::string>> query;
    std::set<std::string> requested_attr;
};
#endif // __INTELLIGENCE_FILTER_H__
