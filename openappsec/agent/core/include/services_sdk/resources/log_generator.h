 

#ifndef __LOG_GENERATOR_H__
#define __LOG_GENERATOR_H__

#include "i_logging.h"
#include "singleton.h"
#include "report/report.h"
#include "i_time_get.h"
#include "config.h"
#include "i_agent_details.h"
#include "i_environment.h"
#include "flags.h"

class LogGen
        :
    Singleton::Consume<I_Logging>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_Environment>
{
public:
    template <typename ...Args>
    LogGen(
        const std::string &title,
        const ReportIS::Audience &_audience,
        const ReportIS::Severity &_severity,
        const ReportIS::Priority &_priority,
        Args ...args)
            :
        LogGen(
            title,
            ReportIS::Level::LOG,
            _audience,
            _severity,
            _priority,
            std::forward<Args>(args)...
        )
    {
    }

    template <typename ...Args>
    LogGen(
        const std::string &title,
        const ReportIS::Level &level,
        const ReportIS::Audience &_audience,
        const ReportIS::Severity &_severity,
        const ReportIS::Priority &_priority,
        Args ...args)
            :
        log(
            title,
            getCurrentTime(),
            ReportIS::Type::EVENT,
            level,
            ReportIS::LogLevel::INFO,
            _audience,
            getAudienceTeam(),
            _severity,
            _priority,
            std::chrono::seconds(0),
            LogField("agentId", Singleton::Consume<I_AgentDetails>::by<LogGen>()->getAgentId()),
            std::forward<Args>(args)...
        )
    {
        loadBaseLogFields();
    }

    ~LogGen();

    LogGen & operator<<(const LogField &field);

    template <typename Error>
    LogGen & operator<<(const Maybe<LogField, Error> &field) { log << field; return *this; }

    void addToOrigin(const LogField &field);

    void serialize(cereal::JSONOutputArchive &ar) const;

    ReportIS::AudienceTeam getAudienceTeam() const;

    std::string getLogInsteadOfSending();

    void addMarkerSuffix(const std::string &suffix);

private:
    std::chrono::microseconds getCurrentTime() const;
    void loadBaseLogFields();

    Report log;
    bool send_log = true;
};

#endif // __LOG_GENERATOR_H__
