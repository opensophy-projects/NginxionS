 

#include "agent_details_report.h"

#include <string>

using namespace std;

AgentDataReport::~AgentDataReport()
{
    if (!should_report) return;
    Singleton::Consume<I_AgentDetailsReporter>::by<AgentDataReport>()->sendReport(
        agent_details,
        policy_version,
        platform,
        architecture,
        agent_version
    );
}

AgentDataReport &
AgentDataReport::operator<<(const pair<string, string> &data)
{
    agent_details << data;
    return *this;
}

bool
AgentDataReport::operator==(const AgentDataReport &other) const
{
    return policy_version == other.policy_version &&
        platform == other.platform &&
        architecture == other.architecture &&
        agent_version  == other.agent_version &&
        agent_details == other.agent_details &&
        attributes == other.attributes;
}

void
AgentDataReport::setPolicyVersion(const string &_policy_version)
{
    policy_version = _policy_version;
}

void
AgentDataReport::setPlatform(const string &_platform)
{
    platform = _platform;
}

void
AgentDataReport::setArchitecture(const string &_architecture)
{
    architecture = _architecture;
}

void
AgentDataReport::setAgentVersion(const string &_agent_version)
{
    agent_version = _agent_version;
}

void
AgentDataReport::disableReportSending()
{
    should_report = false;
}
