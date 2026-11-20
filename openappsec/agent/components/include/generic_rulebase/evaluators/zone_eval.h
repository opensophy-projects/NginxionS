 

#ifndef __ZONE_EVAL_H__
#define __ZONE_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "singleton.h"

class ZoneMatcher : public EnvironmentEvaluator<bool>, Singleton::Consume<I_Environment>
{
public:
    ZoneMatcher(const std::vector<std::string> &zones);

    static std::string getName() { return "zoneId"; }

    Maybe<bool, Context::Error> evalVariable() const override;

    static std::string ctx_key;

private:
    std::string zone_id;
};

#endif // __ZONE_EVAL_H__
