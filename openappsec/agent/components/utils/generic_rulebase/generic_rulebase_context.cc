 

#include "generic_rulebase/generic_rulebase_context.h"

#include <vector>

#include "context.h"
#include "config.h"
#include "generic_rulebase/evaluators/trigger_eval.h"
#include "generic_rulebase/evaluators/parameter_eval.h"
#include "generic_rulebase/evaluators/practice_eval.h"
#include "generic_rulebase/evaluators/zone_eval.h"
#include "generic_rulebase/evaluators/asset_eval.h"

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

using namespace std;

template<typename Configs>
set<GenericConfigId>
extractIds(const vector<Configs> &configurations)
{
    set<GenericConfigId> ids;
    for (const Configs &conf : configurations) {
        ids.insert(conf.getId());
    }
    return ids;
}

void
GenericRulebaseContext::activate(const BasicRuleConfig &rule)
{
    switch(registration_state) {
        case RuleRegistrationState::UNINITIALIZED: {
            registration_state = RuleRegistrationState::REGISTERED;
            ctx.registerValue<set<GenericConfigId>>(
                TriggerMatcher::ctx_key,
                extractIds<RuleTrigger>(rule.getTriggers())
            );
            ctx.registerValue<set<GenericConfigId>>(
                PracticeMatcher::ctx_key,
                extractIds<RulePractice>(rule.getPractices())
            );
            dbgTrace(D_RULEBASE_CONFIG)
                << "Activating current practices. Current practice IDs: "
                << makeSeparatedStr(extractIds<RulePractice>(rule.getPractices()), ", ");

            ctx.registerValue<set<GenericConfigId>>(
                ParameterMatcher::ctx_key,
                extractIds<RuleParameter>(rule.getParameters())
            );
            ctx.registerValue<GenericConfigId>(
                ZoneMatcher::ctx_key,
                rule.getZoneId()
            );
            ctx.registerQuickAccessValue<GenericConfigId>(
                AssetMatcher::ctx_key,
                rule.getAssetId()
            );
            ctx.registerQuickAccessValue<GenericConfigId>(
                TriggerMatcher::ctx_key,
                rule.getAssetId()
            );
            ctx.activate();
            break;
        }
        case RuleRegistrationState::REGISTERED: {
            dbgTrace(D_RULEBASE_CONFIG) << "Activating registered rule values";
            ctx.activate();
            break;
        }
        case RuleRegistrationState::UNREGISTERED: {
            dbgTrace(D_RULEBASE_CONFIG) << "Failed to register rule values";
        }
    }
}

void
GenericRulebaseContext::activate()
{
    switch(registration_state) {
        case RuleRegistrationState::UNINITIALIZED: {
            auto maybe_rule = setConfigurationInCache<BasicRuleConfig>("rulebase", "rulesConfig");
            if (!maybe_rule.ok()) {
                registration_state = RuleRegistrationState::UNREGISTERED;
                return;
            }
            dbgTrace(D_RULEBASE_CONFIG) << "Registering new rule values";
            activate(maybe_rule.unpack());
            registration_state = RuleRegistrationState::REGISTERED;
            break;
        }
        case RuleRegistrationState::REGISTERED: {
            dbgTrace(D_RULEBASE_CONFIG) << "Activating registered rule values";
            ctx.activate();
            break;
        }
        case RuleRegistrationState::UNREGISTERED: {
            dbgTrace(D_RULEBASE_CONFIG) << "Failed to register rule values";
        }
    }
}
