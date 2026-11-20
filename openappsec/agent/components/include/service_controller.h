 

#ifndef __SERVICE_CONTROLLER_H__
#define __SERVICE_CONTROLLER_H__

#include "i_service_controller.h"

#include <map>
#include <set>

#include "i_orchestration_tools.h"
#include "i_orchestration_status.h"
#include "i_shell_cmd.h"
#include "i_rest_api.h"
#include "i_tenant_manager.h"
#include "i_messaging.h"
#include "service_details.h"
#include "i_mainloop.h"
#include "component.h"

class ServiceController
        :
    public Component,
    Singleton::Provide<I_ServiceController>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_OrchestrationStatus>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_TenantManager>,
    Singleton::Consume<I_TimeGet>
{
public:
    ServiceController();
    ~ServiceController();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __SERVICE_CONTROLLER_H__
