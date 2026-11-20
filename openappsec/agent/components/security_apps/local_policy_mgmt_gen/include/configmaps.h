 

#ifndef __CONFIGMAPS_H__
#define __CONFIGMAPS_H__

#include <vector>
#include <map>

#include "config.h"
#include "debug.h"
#include "rest.h"
#include "cereal/archives/json.hpp"
#include <cereal/types/map.hpp>
#include "customized_cereal_map.h"

#include "local_policy_common.h"

class ConfigMaps : public ClientRest
{
public:
    bool loadJson(const std::string &json);

    std::string getFileContent() const;
    std::string getFileName() const;

private:
    std::map<std::string, std::string> data;
};

#endif // __CONFIGMAPS_H__
