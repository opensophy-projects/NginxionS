 

#ifndef __LOCAL_POLICY_MGMT_GEN_H__
#define __LOCAL_POLICY_MGMT_GEN_H__

#include "config.h"
#include "component.h"
#include "i_mainloop.h"
#include "i_local_policy_mgmt_gen.h"
#include "i_env_details.h"
#include "i_shell_cmd.h"
#include "i_orchestration_tools.h"

class LocalPolicyMgmtGenerator
        :
    public Component,
    Singleton::Provide<I_LocalPolicyMgmtGen>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_EnvDetails>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_Messaging>
{
public:
    LocalPolicyMgmtGenerator();
    ~LocalPolicyMgmtGenerator();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __LOCAL_POLICY_MGMT_GEN_H__
