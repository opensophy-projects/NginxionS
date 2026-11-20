 

#ifndef __TRIGGER_EVAL_H__
#define __TRIGGER_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "singleton.h"

class TriggerMatcher : public EnvironmentEvaluator<bool>, Singleton::Consume<I_Environment>
{
public:
    TriggerMatcher(const std::vector<std::string> &params);

    static std::string getName() { return "triggerId"; }

    Maybe<bool, Context::Error> evalVariable() const override;

    static std::string ctx_key;

private:
    std::string trigger_id;
};

#endif // __TRIGGER_EVAL_H__
