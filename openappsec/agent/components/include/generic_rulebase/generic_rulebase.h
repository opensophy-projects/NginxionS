 

#ifndef __GENERIC_RULEBASE_H__
#define __GENERIC_RULEBASE_H__

#include <memory>

#include "i_generic_rulebase.h"
#include "i_intelligence_is_v2.h"
#include "singleton.h"
#include "component.h"

class GenericRulebase
        :
    public Component,
    Singleton::Provide<I_GenericRulebase>,
    Singleton::Consume<I_Intelligence_IS_V2>
{
public:
    GenericRulebase();
    ~GenericRulebase();

    void preload();

    void init();
    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __GENERIC_RULEBASE_H__
