 

#ifndef __PARAMETER_EVAL_H__
#define __PARAMETER_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "singleton.h"

class ParameterMatcher : public EnvironmentEvaluator<bool>, Singleton::Consume<I_Environment>
{
public:
    ParameterMatcher(const std::vector<std::string> &params);

    static std::string getName() { return "parameterId"; }

    Maybe<bool, Context::Error> evalVariable() const override;

    static std::string ctx_key;

private:
    std::string parameter_id;
};

#endif // __PARAMETER_EVAL_H__
