 

#include "intelligence_is_v2/query_types_v2.h"

using namespace std;
using namespace Intelligence_IS_V2;

void
SerializableQueryTypes::serializeMultiTenant(cereal::JSONOutputArchive &ar) const
{
    ar(cereal::make_nvp("multiTenant", *tenants));
}

void
SerializableQueryTypes::serializeCrossTenantAssetDB(cereal::JSONOutputArchive &ar) const
{
    ar(cereal::make_nvp("queryCrossTenantAssetDB", *query_cross_tenant_asset_db));
}

void
SerializableQueryTypes::save(cereal::JSONOutputArchive &ar) const
{
    if (!tenants.ok() && !query_cross_tenant_asset_db.ok()) return;

    ar.setNextName("queryTypes");
    ar.startNode();
    if (tenants.ok()) serializeMultiTenant(ar);
    if (query_cross_tenant_asset_db.ok()) serializeCrossTenantAssetDB(ar);
    ar.finishNode();
}

void
SerializableQueryTypes::setSerializableTenantList(const vector<string> &tenant_list)
{
    tenants = tenant_list;
};

void
SerializableQueryTypes::setQueryCrossTenantAssetDB(bool cross_tenant_asset_db)
{
    query_cross_tenant_asset_db = cross_tenant_asset_db;
}
