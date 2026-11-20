 

#ifndef __HEALTH_CHECK_MANAGER_H__
#define __HEALTH_CHECK_MANAGER_H__

#include "singleton.h"
#include "i_health_check_manager.h"
#include "i_mainloop.h"
#include "i_rest_api.h"
#include "component.h"
#include "i_messaging.h"
#include "i_environment.h"

class HealthCheckManager
        :
    public Component,
    Singleton::Provide<I_Health_Check_Manager>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_Environment>
{
public:
    HealthCheckManager();
    ~HealthCheckManager();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __HEALTH_CHECK_MANAGER_H__
