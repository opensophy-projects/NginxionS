 

#include "environment_evaluator.h"
#include "evaluator_registration.h"

using namespace std;
using namespace EnvironmentHelper;

class AllEvaluator : public EnvironmentEvaluator<bool>
{
public:
    AllEvaluator(const vector<string> &params)
    {
        for (const auto &param : params) {
            conditions.push_back(getMatcher<bool>(param));
        }
    }

    Maybe<bool, Context::Error>
    evalVariable() const override
    {
        for (auto &cond : conditions) {
            auto res = cond->evalVariable();
            if (!res.ok()) return res;
            if (res.unpack() == false) return false;
        }
        return true;
    }

    static std::string getName() { return "All"; }

private:
    vector<EvaluatorPtr<bool>> conditions;
};

class AnyEvaluator : public EnvironmentEvaluator<bool>
{
public:
    AnyEvaluator(const vector<string> &params)
    {
        for (const auto &param : params) {
            conditions.push_back(getMatcher<bool>(param));
        }
    }

    Maybe<bool, Context::Error>
    evalVariable() const override
    {
        for (auto &cond : conditions) {
            auto res = cond->evalVariable();
            if (!res.ok()) return res;
            if (res.unpack() == true) return true;
        }
        return false;
    }

    static std::string getName() { return "Any"; }

private:
    vector<EvaluatorPtr<bool>> conditions;
};

class NotEvaluator : public EnvironmentEvaluator<bool>
{
public:
    NotEvaluator(const vector<string> &params)
    {
        if (params.size() != 1) reportWrongNumberOfParams(getName(), params.size(), 1, 1);
        cond = getMatcher<bool>(params[0]);
    }

    Maybe<bool, Context::Error>
    evalVariable() const override
    {
        auto res = cond->evalVariable();
        if (!res.ok()) return res;
        return !(res.unpack());
    }

    static std::string getName() { return "Not"; }

private:
    EvaluatorPtr<bool> cond;
};

void
registerBaseEvaluators()
{
    addMatcher<AllEvaluator>();
    addMatcher<AnyEvaluator>();
    addMatcher<NotEvaluator>();
}
