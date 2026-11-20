 

#include "WaapParameters.h"

using namespace Waap::Parameters;

bool WaapParameters::operator==(const WaapParameters &other) const
{
    return m_paramMap == other.m_paramMap;
}

ParamMap WaapParameters::getParamsMap() const
{
    return m_paramMap;
}

Value WaapParameters::getParamVal(Parameter key, Value defaultVal)
{
    if (m_paramMap.find(key) == m_paramMap.end())
    {
        return defaultVal;
    }
    return m_paramMap[key];
}
