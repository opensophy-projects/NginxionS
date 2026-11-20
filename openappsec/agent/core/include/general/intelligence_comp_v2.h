 

#ifndef __INTELLIGENCE_COMP_V2_H__
#define __INTELLIGENCE_COMP_V2_H__

#include "i_intelligence_is_v2.h"

#include "singleton.h"
#include "i_messaging.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "i_agent_details.h"
#include "i_rest_api.h"
#include "component.h"

class IntelligenceComponentV2
        :
    public Component,
    Singleton::Provide<I_Intelligence_IS_V2>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_Environment>
{
public:
    IntelligenceComponentV2();
    ~IntelligenceComponentV2();

    void init();

    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __INTELLIGENCE_COMP_V2_H__
