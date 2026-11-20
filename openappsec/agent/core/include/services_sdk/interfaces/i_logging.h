 

#ifndef __I_LOGGING_H__
#define __I_LOGGING_H__

#include <functional>

#include "report/report.h"
#include "report/log_rest.h"

class I_Logging
{
public:
    using GeneralModifier = std::function<void(LogBulkRest &)>;

    virtual bool addStream(ReportIS::StreamType type) = 0;
    virtual bool addStream(
        ReportIS::StreamType type,
        const std::string &log_server_url,
        const std::string &protocol
    ) = 0;
    virtual bool delStream(ReportIS::StreamType type) = 0;

    virtual void sendLog(const Report &msg) = 0;

    virtual uint64_t getCurrentLogId() = 0;

    virtual void addGeneralModifier(const GeneralModifier &modifier) = 0;

protected:
    virtual ~I_Logging() {}
};

#endif // __I_LOGGING_H__
