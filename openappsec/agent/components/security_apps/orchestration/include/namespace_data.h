 

#ifndef __NAMESPACE_DATA_H__
#define __NAMESPACE_DATA_H__

#include <vector>
#include <map>

#include "cereal/archives/json.hpp"
#include <cereal/types/map.hpp>

#include "rest.h"

class NamespaceData : public ClientRest
{
public:
    bool loadJson(const std::string &json);
    Maybe<std::string> getNamespaceUidByName(const std::string &name) const;

private:
    std::map<std::string, std::string> ns_name_to_uid;
};

#endif // __NAMESPACE_DATA_H__
