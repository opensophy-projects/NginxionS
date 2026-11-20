 

#ifndef __MESSAGING_H__
#define __MESSAGING_H__

#include "i_messaging.h"

#include "component.h"
#include "singleton.h"

#include "i_environment.h"
#include "i_proxy_configuration.h"
#include "i_agent_details.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "i_encryptor.h"
#include "i_shell_cmd.h"
#include "i_rest_api.h"
#include "i_instance_awareness.h"

#include "config.h"

class Messaging
        :
    public Component,
    Singleton::Provide<I_Messaging>,
    Singleton::Consume<I_ProxyConfiguration>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_Encryptor>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_InstanceAwareness>
{
public:
    Messaging();
    ~Messaging();

    void init();
    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MESSAGING_H__
