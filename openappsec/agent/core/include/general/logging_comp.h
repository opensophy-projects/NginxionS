 

#ifndef __LOGGING_COMP_H__
#define __LOGGING_COMP_H__

#include <memory>

#include "i_logging.h"
#include "i_messaging.h"
#include "singleton.h"
#include "i_mainloop.h"
#include "i_instance_awareness.h"
#include "i_socket_is.h"
#include "component.h"
#include "i_agent_details.h"
#include "i_shell_cmd.h"

class LoggingComp
        :
    public Component,
    Singleton::Provide<I_Logging>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_InstanceAwareness>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_Logging>,
    Singleton::Consume<I_Socket>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_ShellCmd>
{
public:
    LoggingComp();
    ~LoggingComp();

    void init();

    void fini();

    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __LOGGING_COMP_H__
