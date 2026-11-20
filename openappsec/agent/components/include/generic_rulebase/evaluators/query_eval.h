 

#ifndef __QUERY_EVAL_H__
#define __QUERY_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "i_generic_rulebase.h"
#include "singleton.h"

class QueryMatcher
        :
    public EnvironmentEvaluator<bool>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_GenericRulebase>
{
public:
    QueryMatcher(const std::vector<std::string> &query_params);

    static std::string getName() { return "matchQuery"; }

    Maybe<bool, Context::Error> evalVariable() const override;

private:
    static const std::string contextKeyToString(Context::MetaDataType type);

    std::string key;
    std::unordered_set<std::string> values;
    bool is_any = false;
};

#endif // __QUERY_EVAL_H__
