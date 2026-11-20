 

#ifndef __LOG_GEN_WRAPPER_H__
#define __LOG_GEN_WRAPPER_H__

#include "report/report_enums.h"
#include "maybe_res.h"
#include "config.h"
#include "generic_rulebase/triggers_config.h"
#include <string>
#include <memory>

class LogTriggerConf;
class LogGen;

class LogGenWrapper
{
public:
    LogGenWrapper(
        const Maybe<LogTriggerConf, Config::Errors>& maybe_trigger,
        const std::string& title,
        const ReportIS::Audience& audience,
        const LogTriggerConf::SecurityType& security_type,
        const ReportIS::Severity& severity,
        const ReportIS::Priority& priority,
        bool is_action_drop_or_prevent);
    ~LogGenWrapper();

    LogGen& getLogGen();

private:
    std::unique_ptr<LogGen> m_log_gen;
};

#endif
