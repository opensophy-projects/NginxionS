 

#ifndef __DETAILS_RESOLVER_H__
#define __DETAILS_RESOLVER_H__

#include <memory>
#include <string>

#include "i_orchestration_tools.h"
#include "i_details_resolver.h"
#include "i_shell_cmd.h"
#include "singleton.h"
#include "component.h"

class DetailsResolver
        :
    public Component,
    Singleton::Provide<I_DetailsResolver>,
    Singleton::Consume<I_OrchestrationTools>
{
public:
    DetailsResolver();
    ~DetailsResolver();

    void preload() override;
    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __DETAILS_RESOLVER_H__
