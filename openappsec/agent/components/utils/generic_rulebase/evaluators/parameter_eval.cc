 

#include "generic_rulebase/evaluators/parameter_eval.h"

#include <vector>
#include <string>

#include "generic_rulebase/rulebase_config.h"
#include "config.h"
#include "debug.h"

using namespace std;

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

string ParameterMatcher::ctx_key = "parameters";

ParameterMatcher::ParameterMatcher(const vector<string> &params)
{
    if (params.size() != 1) reportWrongNumberOfParams(ParameterMatcher::getName(), params.size(), 1, 1);
    parameter_id = params[0];
}

Maybe<bool, Context::Error>
ParameterMatcher::evalVariable() const
{
    I_Environment *env = Singleton::Consume<I_Environment>::by<ParameterMatcher>();
    auto bc_param_id_ctx = env->get<set<GenericConfigId>>(ParameterMatcher::ctx_key);
    dbgTrace(D_RULEBASE_CONFIG)
        << "Trying to match parameter. ID: "
        << parameter_id << ", Current set IDs: "
        << makeSeparatedStr(bc_param_id_ctx.ok() ? *bc_param_id_ctx : set<GenericConfigId>(), ", ");
    if (bc_param_id_ctx.ok()) return bc_param_id_ctx.unpack().count(parameter_id) > 0;

    dbgTrace(D_RULEBASE_CONFIG)
        << "Did not find current parameter in context."
        << " Match parameter from current rule";
    auto rule = getConfigurationWithCache<BasicRuleConfig>("rulebase", "rulesConfig");
    return rule.ok() && rule.unpack().isParameterActive(parameter_id);
}
