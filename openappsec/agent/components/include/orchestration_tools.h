 

#ifndef __ORCHESTRATION_TOOLS_H__
#define __ORCHESTRATION_TOOLS_H__

#include <fstream>

#include "i_orchestration_tools.h"
#include "i_shell_cmd.h"
#include "i_tenant_manager.h"
#include "component.h"
#include "i_env_details.h"
#include "i_messaging.h"
#include "i_environment.h"
#include "i_agent_details.h"
#include "i_mainloop.h"

class OrchestrationTools
        :
    public Component,
    Singleton::Provide<I_OrchestrationTools>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_TenantManager>,
    Singleton::Consume<I_EnvDetails>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_AgentDetails>
{
public:
    OrchestrationTools();
    ~OrchestrationTools();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __ORCHESTRATION_TOOLS_H__
