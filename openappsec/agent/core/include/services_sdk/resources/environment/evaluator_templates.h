 

#ifndef __EVALUATOR_TEMPLATES_H__
#define __EVALUATOR_TEMPLATES_H__

#include "environment_evaluator.h"

namespace EnvironmentHelper
{

template <typename Value>
class Constant : public EnvironmentEvaluator<Value>
{
    using Method = Value(*)(const std::string &);
public:
    Constant(Method parse, const std::vector<std::string> &params)
    {
        if (params.size() != 1) reportWrongNumberOfParams(getName(), params.size(), 1, 1);
        value = parse(params[0]);
    }

    Maybe<Value, Context::Error>
    evalVariable() const override
    {
        return value;
    }

    static std::string getName() { return "Constant"; }

private:
    Value value;
};

template <typename Value>
class Equal : public EnvironmentEvaluator<bool>
{
public:
    Equal(const std::vector<std::string> &params)
    {
        if (params.size() != 2) reportWrongNumberOfParams(getName(), params.size(), 2, 2);
        auto repo = EvaluatorsRepo<Value>::getRepo();
        one = repo->getMatcher(params[0]);
        two = repo->getMatcher(params[1]);
    }

    Maybe<bool, Context::Error>
    evalVariable() const override
    {
        auto res1 = one->evalVariable();
        if (!res1.ok()) return res1.passErr();
        auto res2 = two->evalVariable();
        if (!res2.ok()) return res2.passErr();
        return *res1 == *res2;
    }

    static std::string getName() { return "Equal"; }

private:
    EvaluatorPtr<Value> one, two;
};

template <typename Value, typename T>
class Invoker : public EnvironmentEvaluator<Value>
{
    using Method = Value(*)(const T &);
public:
    Invoker(Method _method, const std::vector<std::string> &params) : method(_method)
    {
        if (params.size() != 1) reportWrongNumberOfParams(getName(), params.size(), 1, 1);
        auto repo = EvaluatorsRepo<T>::getRepo();
        instance  = repo->getMatcher(params[0]);
    }

    Maybe<Value, Context::Error>
    evalVariable() const override
    {
        auto res = instance->evalVariable();
        if (!res.ok()) return res.passErr();
        return method(res.unpack());
    }

    static std::string getName() { return "Invoker"; }

private:
    Method method;
    EvaluatorPtr<T> instance;
};

} // namespace EnvironmentHelper

#endif // __EVALUATOR_TEMPLATES_H__
