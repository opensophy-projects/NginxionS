 

#ifndef __ORCHESTRATION_STATUS_H__
#define __ORCHESTRATION_STATUS_H__

#include "i_orchestration_status.h"

#include <cereal/archives/json.hpp>

#include "singleton.h"
#include "component.h"
#include "i_orchestration_tools.h"
#include "i_time_get.h"
#include "i_mainloop.h"
#include "i_agent_details.h"
#include "customized_cereal_map.h"

class OrchestrationStatus
        :
    public Component,
    Singleton::Provide<I_OrchestrationStatus>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_MainLoop>
{
public:
    OrchestrationStatus();
    ~OrchestrationStatus();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __ORCHESTRATION_STATUS_H__
