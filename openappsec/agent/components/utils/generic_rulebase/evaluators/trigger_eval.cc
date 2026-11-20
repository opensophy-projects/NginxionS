 

#include "generic_rulebase/evaluators/trigger_eval.h"

#include <vector>
#include <string>

#include "generic_rulebase/rulebase_config.h"
#include "config.h"
#include "debug.h"

using namespace std;

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

string TriggerMatcher::ctx_key = "triggers";

TriggerMatcher::TriggerMatcher(const vector<string> &params)
{
    if (params.size() != 1) reportWrongNumberOfParams(TriggerMatcher::getName(), params.size(), 1, 1);
    trigger_id = params[0];
}

Maybe<bool, Context::Error>
TriggerMatcher::evalVariable() const
{
    I_Environment *env = Singleton::Consume<I_Environment>::by<TriggerMatcher>();
    auto ac_bc_trigger_id_ctx = env->get<set<GenericConfigId>>("ac_trigger_id");
    dbgTrace(D_RULEBASE_CONFIG)
        << "Trying to match trigger for access control rule. ID: "
        << trigger_id << ", Current set IDs: "
        << makeSeparatedStr(ac_bc_trigger_id_ctx.ok() ? *ac_bc_trigger_id_ctx : set<GenericConfigId>(), ", ");
    if (ac_bc_trigger_id_ctx.ok()) {
        return ac_bc_trigger_id_ctx.unpack().count(trigger_id) > 0;
    }

    auto bc_trigger_id_ctx = env->get<set<GenericConfigId>>(TriggerMatcher::ctx_key);
    dbgTrace(D_RULEBASE_CONFIG)
        << "Trying to match trigger. ID: "
        << trigger_id << ", Current set IDs: "
        << makeSeparatedStr(bc_trigger_id_ctx.ok() ? *bc_trigger_id_ctx : set<GenericConfigId>(), ", ");
    if (bc_trigger_id_ctx.ok()) return bc_trigger_id_ctx.unpack().count(trigger_id) > 0;

    auto rule = getConfigurationWithCache<BasicRuleConfig>("rulebase", "rulesConfig");
    return rule.ok() && rule.unpack().isTriggerActive(trigger_id);
}
