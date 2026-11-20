 

#ifndef __SIGNAL_HANDLER_H__
#define __SIGNAL_HANDLER_H__

#include "config.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "i_agent_details.h"
#include "i_environment.h"
#include "i_messaging.h"
#include "i_signal_handler.h"
#include "config/i_config.h"
#include "component.h"

class SignalHandler
        :
    public Component,
    Singleton::Provide<I_SignalHandler>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<Config::I_Config>
{
public:
    SignalHandler();
    ~SignalHandler();

    void init();
    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __SIGNAL_HANDLER_H__
