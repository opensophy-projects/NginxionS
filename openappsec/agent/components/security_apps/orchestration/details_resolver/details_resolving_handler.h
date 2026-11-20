 

#ifndef __DETAILS_RESOLVING_HANDLER_H__
#define __DETAILS_RESOLVING_HANDLER_H__

#include <string>
#include <map>

#include "i_shell_cmd.h"
#include "i_orchestration_tools.h"
#include "i_agent_details_reporter.h"

class DetailsResolvingHanlder
        :
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_AgentDetailsReporter>
{
public:
    DetailsResolvingHanlder();
    ~DetailsResolvingHanlder();

    void init();
    std::map<std::string, std::string> getResolvedDetails() const;

    static Maybe<std::string> getCommandOutput(const std::string &cmd);

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __DETAILS_RESOLVING_HANDLER_H__
