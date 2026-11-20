 

#ifndef __QUERY_TYPES_V2_H__
#define __QUERY_TYPES_V2_H__

#include "cereal/archives/json.hpp"
#include "cereal/types/string.hpp"
#include "cereal/types/tuple.hpp"
#include "cereal/types/vector.hpp"
#include "intelligence_types_v2.h"
#include "maybe_res.h"

#include <vector>
#include <unordered_map>

class SerializableQueryTypes
{
public:
    SerializableQueryTypes() {};

    void save(cereal::JSONOutputArchive &ar) const;
    void setSerializableTenantList(const std::vector<std::string> &tenant_list);
    void setQueryCrossTenantAssetDB(bool query_cross_tenant_asset_db);

private:
    void serializeMultiTenant(cereal::JSONOutputArchive &ar) const;
    void serializeCrossTenantAssetDB(cereal::JSONOutputArchive &ar) const;

    Maybe<std::vector<std::string>> tenants = genError("tenant list is uninitialized");
    Maybe<bool> query_cross_tenant_asset_db = genError("cross tenant asset db query is uninitialized");
};

#endif // __QUERY_TYPES_V2_H__
