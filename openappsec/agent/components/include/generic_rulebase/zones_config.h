 

#ifndef __ZONES_CONFIG_H__
#define __ZONES_CONFIG_H__

#include <vector>
#include <string>
#include <set>
#include <arpa/inet.h>

#include "generic_rulebase_context.h"
#include "match_query.h"
#include "i_generic_rulebase.h"
#include "zone.h"

class Zones
{
public:
    void load(cereal::JSONInputArchive &archive_in)
    {
        cereal::load(archive_in, zones);
    }

    const std::vector<Zone> & getZones() const { return zones; }

    std::vector<Zone> zones;
};

class ZonesConfig : Singleton::Consume<I_GenericRulebase>
{
public:
    static void preload();

    void load(cereal::JSONInputArchive &archive_in);

    const std::vector<Zone> & getZones() const { return zones; }

private:
    std::vector<Zone> zones;
};

#endif //__ZONES_CONFIG_H__
