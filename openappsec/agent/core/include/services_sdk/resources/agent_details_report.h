 

#ifndef __AGENT_DETAILS_REPORT_H__
#define __AGENT_DETAILS_REPORT_H__

#include <string>
#include <map>

#include "i_agent_details_reporter.h"
#include "singleton.h"
#include "maybe_res.h"

#define AgentReportField(value) make_pair(#value, value)
#define AgentReportFieldWithLabel(key, value) make_pair(key, value)

class AgentDataReport
        :
    Singleton::Consume<I_AgentDetailsReporter>
{
public:
    AgentDataReport() = default;
    AgentDataReport(bool disable_report_sending) { should_report = disable_report_sending; }
    ~AgentDataReport();

    AgentDataReport & operator<<(const std::pair<std::string, std::string> &data);

    bool operator==(const AgentDataReport& other) const;

    void setPolicyVersion(const std::string &policy_version);
    void setPlatform(const std::string &platform);
    void setArchitecture(const std::string &architecture);
    void setAgentVersion(const std::string &_agent_version);
    void disableReportSending();

private:
    metaDataReport agent_details;
    bool should_report = true;
    Maybe<std::string> policy_version = genError("Not set");
    Maybe<std::string> platform = genError("Not set");
    Maybe<std::string> architecture = genError("Not set");
    Maybe<std::string> agent_version = genError("Not set");
    Maybe<std::map<std::string, std::string>> attributes = genError("Not set");
};

#endif // __AGENT_DETAILS_REPORT_H__
