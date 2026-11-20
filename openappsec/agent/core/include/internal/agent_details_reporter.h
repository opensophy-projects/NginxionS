 

#ifndef __AGENT_DETAILS_REPORTER_H__
#define __AGENT_DETAILS_REPORTER_H__

#include "singleton.h"
#include "component.h"
#include "i_agent_details_reporter.h"
#include "i_messaging.h"
#include "i_environment.h"
#include "i_mainloop.h"
#include "i_rest_api.h"
#include "component.h"

class AgentDetailsReporter
        :
    public Component,
    Singleton::Provide<I_AgentDetailsReporter>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_RestApi>
{
public:
    AgentDetailsReporter();
    ~AgentDetailsReporter();

    void preload() override;

    void init() override;
    void fini() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __AGENT_DETAILS_REPORTER_H__
