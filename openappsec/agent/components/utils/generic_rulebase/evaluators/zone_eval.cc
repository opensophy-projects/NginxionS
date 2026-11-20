 

#include "generic_rulebase/evaluators/zone_eval.h"

#include <vector>
#include <string>

#include "generic_rulebase/zone.h"
#include "generic_rulebase/rulebase_config.h"
#include "config.h"

using namespace std;

string ZoneMatcher::ctx_key = "zone_id";

ZoneMatcher::ZoneMatcher(const vector<string> &params)
{
    if (params.size() != 1) reportWrongNumberOfParams(ZoneMatcher::getName(), params.size(), 1, 1);
    zone_id = params[0];
}

Maybe<bool, Context::Error>
ZoneMatcher::evalVariable() const
{
    I_Environment *env = Singleton::Consume<I_Environment>::by<ZoneMatcher>();
    auto bc_zone_id_ctx = env->get<GenericConfigId>(ZoneMatcher::ctx_key);
    if (bc_zone_id_ctx.ok() && *bc_zone_id_ctx == zone_id) return true;

    if (!getProfileAgentSettingWithDefault<bool>(false, "rulebase.enableQueryBasedMatch")) return false;

    auto zone = getConfiguration<Zone>("rulebase", "zones");
    return zone.ok() && zone.unpack().getId() == zone_id;
}
