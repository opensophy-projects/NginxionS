 

#ifndef __PACKAGE_HANDLER_H__
#define __PACKAGE_HANDLER_H__

#include "i_package_handler.h"
#include "i_orchestration_tools.h"
#include "i_shell_cmd.h"
#include "i_environment.h"
#include "component.h"

class PackageHandler
        :
    public Component,
    Singleton::Provide<I_PackageHandler>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_Environment>
{
public:
    PackageHandler();
    ~PackageHandler();

    void preload() override;

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __PACKAGE_HANDLER_H__
