 

#ifndef __I_GENERIC_RULEBASE_H__
#define __I_GENERIC_RULEBASE_H__

#include <vector>

#include "generic_rulebase/parameters_config.h"
#include "generic_rulebase/triggers_config.h"
#include "generic_rulebase/zone.h"
#include "config.h"

class I_GenericRulebase
{
public:
    virtual Maybe<Zone, Config::Errors> getLocalZone() const = 0;
    virtual Maybe<Zone, Config::Errors> getOtherZone() const = 0;

    virtual LogTriggerConf getLogTriggerConf(const std::string &trigger_Id) const = 0;
    virtual ParameterException getParameterException(const std::string &parameter_Id) const = 0;

    using ParameterKeyValues = std::unordered_map<std::string, std::set<std::string>>;
    virtual std::set<ParameterBehavior> getBehavior(const ParameterKeyValues &key_value_pairs) const = 0;

protected:
    ~I_GenericRulebase() {}
};

#endif // __I_GENERIC_RULEBASE_H__
