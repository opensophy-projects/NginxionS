 

#ifndef __ENVIRONMENT_H__
#define __ENVIRONMENT_H__

#include <memory>
#include "i_environment.h"
#include "i_tenant_manager.h"
#include "singleton.h"
#include "component.h"

class I_RestApi;

class Environment
        :
    public Component,
    Singleton::Provide<I_Environment>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_TenantManager>
{
public:
    Environment();
    ~Environment();

    void init();
    void fini();
    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __ENVIRONMENT_H__
