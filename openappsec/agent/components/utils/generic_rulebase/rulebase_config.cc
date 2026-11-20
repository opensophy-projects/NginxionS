 

#include "generic_rulebase/rulebase_config.h"

#include "telemetry.h"
#include "config.h"

USE_DEBUG_FLAG(D_RULEBASE_CONFIG);

using namespace std;

set<string> BasicRuleConfig::assets_ids{};
set<string> BasicRuleConfig::assets_ids_aggregation{};

void
BasicRuleConfig::load(cereal::JSONInputArchive &ar)
{
    parseJSONKey<vector<RulePractice>>("practices", practices, ar);
    parseJSONKey<vector<RuleTrigger>>("triggers", triggers, ar);
    parseJSONKey<vector<RuleParameter>>("parameters", parameters, ar);
    parseJSONKey<uint8_t>("priority", priority, ar);
    parseJSONKey<string>("ruleId", rule_id, ar);
    parseJSONKey<string>("ruleName", rule_name, ar);
    parseJSONKey<string>("assetId", asset_id, ar);
    parseJSONKey<string>("assetName", asset_name, ar);
    parseJSONKey<string>("zoneId", zone_id, ar);
    parseJSONKey<string>("zoneName", zone_name, ar);

    assets_ids_aggregation.insert(asset_id);
}

void
BasicRuleConfig::updateCountMetric()
{
    BasicRuleConfig::assets_ids = BasicRuleConfig::assets_ids_aggregation;
    AssetCountEvent(AssetType::ALL, BasicRuleConfig::assets_ids.size()).notify();
}

bool
BasicRuleConfig::isPracticeActive(const string &practice_id) const
{
    for (auto practice: practices) {
        if (practice.getId() == practice_id) return true;
    }
    return false;
}

bool
BasicRuleConfig::isTriggerActive(const string &trigger_id) const
{
    for (auto trigger: triggers) {
        if (trigger.getId() == trigger_id) {
            return true;
        }
    }
    return false;
}

bool
BasicRuleConfig::isParameterActive(const string &parameter_id) const
{
    for (auto param: parameters) {
        if (param.getId() == parameter_id) {
            return true;
        }
    }
    return false;
}
