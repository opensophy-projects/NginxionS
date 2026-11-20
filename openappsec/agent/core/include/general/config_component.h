 

#ifndef __CONFIG_COMPONENT_H__
#define __CONFIG_COMPONENT_H__

#include <string>
#include <vector>

#include "config.h"
#include "singleton.h"
#include "i_rest_api.h"
#include "i_time_get.h"
#include "i_mainloop.h"
#include "i_environment.h"
#include "i_messaging.h"
#include "i_instance_awareness.h"
#include "i_tenant_manager.h"
#include "component.h"

class ConfigComponent
        :
    public Component,
    Singleton::Provide<Config::I_Config>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_InstanceAwareness>,
    Singleton::Consume<I_TenantManager>
{
public:
    ConfigComponent();
    ~ConfigComponent();

    void preload();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __CONFIG_COMPONENT_H__
