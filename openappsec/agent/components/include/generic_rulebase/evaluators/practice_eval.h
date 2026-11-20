 

#ifndef __PRACTICE_EVAL_H__
#define __PRACTICE_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "singleton.h"

class PracticeMatcher : public EnvironmentEvaluator<bool>, Singleton::Consume<I_Environment>
{
public:
    PracticeMatcher(const std::vector<std::string> &params);

    static std::string getName() { return "practiceId"; }

    Maybe<bool, Context::Error> evalVariable() const override;

    static std::string ctx_key;

private:
    std::string practice_id;
};

#endif // __PRACTICE_EVAL_H__
