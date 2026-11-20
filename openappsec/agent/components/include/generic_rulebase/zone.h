 

#ifndef __ZONE_H__
#define __ZONE_H__

#include <vector>
#include <string>
#include <set>
#include <arpa/inet.h>

#include "generic_rulebase_context.h"
#include "match_query.h"
#include "i_environment.h"
#include "i_intelligence_is_v2.h"
#include "asset.h"

class Zone : Singleton::Consume<I_Intelligence_IS_V2>, Singleton::Consume<I_Environment>
{
    using AttrData = std::unordered_map<std::string, std::set<std::string>>;

public:
    enum class Direction { To, From, Bidirectional };

    void load(cereal::JSONInputArchive &archive_in);

    bool contains(const Asset &asset);

    GenericConfigId getId() const { return zone_id; }
    const std::string & getName() const { return zone_name; }
    const std::vector<std::pair<Direction, GenericConfigId>> & getAdjacentZones() const { return adjacent_zones; }
    const MatchQuery & getMatchQuery() const { return match_query; }
    bool isAnyZone() const { return is_any; }

private:
    bool matchAttributes(const AttrData &data);

    GenericConfigId zone_id;
    std::string zone_name;
    std::vector<std::pair<Direction, GenericConfigId>> adjacent_zones;
    MatchQuery match_query;
    bool is_any;
};

#endif // __ZONE_H__
