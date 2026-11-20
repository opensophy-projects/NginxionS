 

#ifndef __MAINLOOP_H__
#define __MAINLOOP_H__

#include <memory>

#include "i_mainloop.h"
#include "i_environment.h"
#include "i_time_get.h"
#include "i_messaging.h"
#include "i_agent_details.h"
#include "i_signal_handler.h"
#include "singleton.h"
#include "component.h"

extern bool fini_signal_flag;

class MainloopComponent
        :
    public Component,
    Singleton::Provide<I_MainLoop>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_SignalHandler>
{
public:
    MainloopComponent();
    ~MainloopComponent();

    void preload();

    void init();
    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MAINLOOP_H__
