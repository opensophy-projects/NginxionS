 

#ifndef __UPDATES_PROCESS_REPORT_H__
#define __UPDATES_PROCESS_REPORT_H__

#include <sstream>
#include <string>

#include "singleton.h"
#include "i_time_get.h"
#include "updates_process_event.h"

class UpdatesProcessReport : Singleton::Consume<I_TimeGet>
{
public:
    UpdatesProcessReport(
        UpdatesProcessResult result,
        UpdatesConfigType type,
        UpdatesFailureReason reason,
        const std::string &description)
            :
        result(result), type(type), reason(reason), description(description)
    {
        time_stamp = Singleton::Consume<I_TimeGet>::by<UpdatesProcessReport>()->getWalltimeStr();
    }

    std::string
    toString() const
    {
        std::stringstream report;
        report
            << "["
            << time_stamp << "] - "
            << convertUpdateProcessResultToStr(result) << " | "
            << convertUpdatesConfigTypeToStr(type) << " | "
            << convertUpdatesFailureReasonToStr(reason) << " | "
            << description;

        return report.str();
    }

    UpdatesFailureReason getReason() const { return reason; }

private:
    UpdatesProcessResult result;
    UpdatesConfigType type;
    UpdatesFailureReason reason;
    std::string description;
    std::string time_stamp;
};

#endif // __UPDATES_PROCESS_EVENT_H__
