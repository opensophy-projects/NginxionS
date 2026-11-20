 

#ifndef __HEALTH_CHECKER_H__
#define __HEALTH_CHECKER_H__

#include "singleton.h"
#include "i_mainloop.h"
#include "i_socket_is.h"
#include "i_health_check_manager.h"
#include "i_shell_cmd.h"
#include "i_orchestration_status.h"
#include "component.h"
#include "i_service_controller.h"

class HealthChecker
        :
    public Component,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Socket>,
    Singleton::Consume<I_Health_Check_Manager>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_OrchestrationStatus>,
    Singleton::Consume<I_ServiceController>
{
public:
    HealthChecker();
    ~HealthChecker();

    void init() override;
    void fini() override;

    void preload() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __HEALTH_CHECKER_H__
