 

#include "WaapParameters.h"
// NginxionS: the length of a window of learning from the environment (learningIntervalOfEnv below)
#include <cctype>
#include <cstdlib>

using namespace Waap::Parameters;

bool WaapParameters::operator==(const WaapParameters &other) const
{
    return m_paramMap == other.m_paramMap;
}

ParamMap WaapParameters::getParamsMap() const
{
    return m_paramMap;
}

// NginxionS: NGINXIONS_LEARNING_INTERVAL_MINUTES, when set in the environment of the agent, is the length of a window of
// learning in minutes (learning.intervalDuration, 120 by default) for the cluster and GUI tests. smartsync reads the
// same variable. Empty otherwise.
Value
WaapParameters::learningIntervalOfEnv()
{
    const char *interval = getenv("NGINXIONS_LEARNING_INTERVAL_MINUTES");
    if (interval == nullptr) return "";
    Value value(interval);
    if (value.empty() || value.size() > 3) return "";
    for (char c : value) {
        if (!isdigit(static_cast<unsigned char>(c))) return "";
    }
    if (std::stoi(value) < 1) return "";
    return value;
}

Value WaapParameters::getParamVal(Parameter key, Value defaultVal)
{
    // NginxionS: the window of learning of a test stack (learningIntervalOfEnv above)
    if (key == "learning.intervalDuration") {
        Value fromEnv = learningIntervalOfEnv();
        if (!fromEnv.empty()) return fromEnv;
    }
    if (m_paramMap.find(key) == m_paramMap.end())
    {
        return defaultVal;
    }
    return m_paramMap[key];
}
