 

#ifndef __ASSET_EVAL_H__
#define __ASSET_EVAL_H__

#include "environment/evaluator_templates.h"
#include "i_environment.h"
#include "singleton.h"

class AssetMatcher : public EnvironmentEvaluator<bool>, Singleton::Consume<I_Environment>
{
public:
    AssetMatcher(const std::vector<std::string> &params);

    static std::string getName() { return "assetId"; }

    Maybe<bool, Context::Error> evalVariable() const override;

    static std::string ctx_key;

private:
    std::string asset_id;
};

#endif // __ASSET_EVAL_H__
