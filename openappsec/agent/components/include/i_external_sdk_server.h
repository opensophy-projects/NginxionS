 

#ifndef __I_EXTERNAL_SDK_SERVER_H__
#define __I_EXTERNAL_SDK_SERVER_H__

#include <string>
#include <map>

#include "report/report.h"
#include "debug.h"

class I_ExternalSdkServer
{
public:
    virtual void
    sendLog(
        const std::string &event_name,
        ReportIS::Audience audience,
        ReportIS::Severity severity,
        ReportIS::Priority priority,
        const std::string &tag,
        const std::map<std::string, std::string> &additional_fields) = 0;

    virtual void
    sendDebug(
        const std::string &file_name,
        const std::string &function_name,
        unsigned int line_number,
        Debug::DebugLevel debug_level,
        const std::string &trace_id,
        const std::string &span_id,
        const std::string &message,
        const std::map<std::string, std::string> &additional_fields) = 0;

    virtual void
    sendMetric(
        const std::string &event_title,
        const std::string &service_name,
        ReportIS::AudienceTeam team,
        ReportIS::IssuingEngine issuing_engine,
        const std::map<std::string, std::string> &additional_fields) = 0;

    virtual Maybe<std::string> getConfigValue(const std::string &config_path) = 0;

protected:
    virtual ~I_ExternalSdkServer() {}
};

#endif // __I_EXTERNAL_SDK_SERVER_H__
