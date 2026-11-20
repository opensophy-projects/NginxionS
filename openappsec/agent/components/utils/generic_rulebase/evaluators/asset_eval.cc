 

#include "generic_rulebase/evaluators/asset_eval.h"

#include <vector>
#include <string>

#include "generic_rulebase/assets_config.h"
#include "config.h"
#include "debug.h"

using namespace std;

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

string AssetMatcher::ctx_key = "asset_id";

AssetMatcher::AssetMatcher(const vector<string> &params)
{
    if (params.size() != 1) reportWrongNumberOfParams(AssetMatcher::getName(), params.size(), 1, 1);
    asset_id = params[0];
}

Maybe<bool, Context::Error>
AssetMatcher::evalVariable() const
{
    I_Environment *env = Singleton::Consume<I_Environment>::by<AssetMatcher>();
    auto bc_asset_id_ctx = env->get<GenericConfigId>(AssetMatcher::ctx_key);

    if (bc_asset_id_ctx.ok()) {
        dbgTrace(D_RULEBASE_CONFIG)
            << "Asset ID: "
            << asset_id
            << "; Current set assetId context: "
            << *bc_asset_id_ctx;
    } else {
        dbgTrace(D_RULEBASE_CONFIG) << "Asset ID: " << asset_id << ". Empty context";
    }

    return bc_asset_id_ctx.ok() && *bc_asset_id_ctx == asset_id;
}
