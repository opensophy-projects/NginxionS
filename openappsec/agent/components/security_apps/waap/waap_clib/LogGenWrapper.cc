 

#include "LogGenWrapper.h"
#include "log_generator.h"
#include "debug.h"

USE_DEBUG_FLAG(D_WAAP);

LogGenWrapper::LogGenWrapper(
        const Maybe<LogTriggerConf, Config::Errors>& maybe_trigger,
        const std::string& title,
        const ReportIS::Audience& audience,
        const LogTriggerConf::SecurityType& security_type,
        const ReportIS::Severity& severity,
        const ReportIS::Priority& priority,
        bool is_action_drop_or_prevent) : m_log_gen(nullptr)
{
    if (!maybe_trigger.ok()) {
        dbgWarning(D_WAAP) << "Couldn't get log trigger from the I/S. " <<
            "Continuing with waap log trigger policy..." <<
            "Reason: " << maybe_trigger.getErr();
        m_log_gen = std::make_unique<LogGen>(
            title,
            audience,
            severity,
            priority,
            ReportIS::Tags::WAF,
            ReportIS::Tags::THREAT_PREVENTION
            );
    }
    else {
        m_log_gen = std::make_unique<LogGen>(
            title,
            ReportIS::Level::LOG,
            ReportIS::Audience::SECURITY,
            severity,
            priority,
            ReportIS::Tags::WAF,
            ReportIS::Tags::THREAT_PREVENTION,
            maybe_trigger.unpack().getStreams(security_type, is_action_drop_or_prevent),
            maybe_trigger.unpack().getEnrechments(security_type)
        );
    }
}

LogGenWrapper::~LogGenWrapper()
{
}

LogGen& LogGenWrapper::getLogGen()
{
    return *m_log_gen;
}
