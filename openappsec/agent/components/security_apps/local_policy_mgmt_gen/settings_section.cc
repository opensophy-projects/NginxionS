 

#include "settings_section.h"

using namespace std;

USE_DEBUG_FLAG(D_LOCAL_POLICY);
// LCOV_EXCL_START Reason: no test exist

AgentSettingsSection::AgentSettingsSection(
    const string &_key,
    const string &_value)
        :
    key(_key),
    value(_value)
{
    try {
        id = to_string(boost::uuids::random_generator()());
    } catch (const std::exception &e) { // NginxionS: entropy_error is gone from Boost 1.86+ (#113)
        dbgWarning(D_LOCAL_POLICY) << "Failed to generate agent setting UUID. Error: " << e.what();
    }
}

void
AgentSettingsSection::save(cereal::JSONOutputArchive &out_ar) const
{
    out_ar(
        cereal::make_nvp("id",    id),
        cereal::make_nvp("key",   key),
        cereal::make_nvp("value", value)
    );
}

const string &
AgentSettingsSection::getSettingId() const
{
    return id;
}

void
SettingsRulebase::save(cereal::JSONOutputArchive &out_ar) const
{
    string profile_type = "Kubernetes";
    out_ar(
        cereal::make_nvp("agentSettings",                agentSettings),
        cereal::make_nvp("agentType",                    profile_type),
        cereal::make_nvp("allowOnlyDefinedApplications", false),
        cereal::make_nvp("anyFog",                       true),
        cereal::make_nvp("maxNumberOfAgents",            10)
    );
    upgrade_settings.save(out_ar);
}

SettingsWrapper::SettingsWrapper(SettingsRulebase _agent) : agent(_agent)
{
    try {
        id = to_string(boost::uuids::random_generator()());
    } catch (const std::exception &e) { // NginxionS: entropy_error is gone from Boost 1.86+ (#113)
        dbgWarning(D_LOCAL_POLICY) << "Failed to generate Settings Wrapper UUID. Error: " << e.what();
    }
}

void
SettingsWrapper::save(cereal::JSONOutputArchive &out_ar) const
{
    out_ar(
        cereal::make_nvp("profileType", profileType),
        cereal::make_nvp("tokenType",   isToken),
        cereal::make_nvp("tokenType",   tokenType),
        cereal::make_nvp("name",        name),
        cereal::make_nvp("id",          id),
        cereal::make_nvp("agent",       agent)
    );
}
// LCOV_EXCL_STOP
