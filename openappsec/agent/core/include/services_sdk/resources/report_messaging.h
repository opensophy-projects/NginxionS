 

#ifndef __REPORT_MESSAGING_H__
#define __REPORT_MESSAGING_H__

#include "singleton.h"
#include "i_time_get.h"
#include "i_messaging.h"
#include "report/report.h"

class ReportMessaging
        :
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_TimeGet>
{
public:
    template <typename ...Args, typename T>
    ReportMessaging(
        const std::string &title,
        const ReportIS::AudienceTeam &audience_team,
        const T &obj,
        Args ...args)
            :
        ReportMessaging(
            title,
            audience_team,
            obj,
            MessageCategory::GENERIC,
            std::forward<Args>(args)...
        )
    {
    }

    template <typename ...Args, typename T>
    ReportMessaging(
        const std::string &title,
        const ReportIS::AudienceTeam &audience_team,
        const T &obj,
        const MessageCategory &message_type,
        Args ...args)
            :
        ReportMessaging(
            title,
            audience_team,
            ReportIS::Severity::INFO,
            ReportIS::Priority::LOW,
            obj,
            message_type,
            std::forward<Args>(args)...
        )
    {
    }

    template <typename ...Args, typename T>
    ReportMessaging(
        const std::string &title,
        const ReportIS::AudienceTeam &audience_team,
        const ReportIS::Severity &severity,
        const ReportIS::Priority &priority,
        const T &obj,
        Args ...args)
            :
        ReportMessaging(
            title,
            audience_team,
            severity,
            priority,
            obj,
            MessageCategory::GENERIC,
            std::forward<Args>(args)...
        )
    {
    }


    template <typename ...Args, typename T>
    ReportMessaging(
        const std::string &title,
        const ReportIS::AudienceTeam &audience_team,
        const ReportIS::Severity &severity,
        const ReportIS::Priority &priority,
        const T &obj,
        const MessageCategory &message_type,
        Args ...args)
            :
        report(
            title,
            Singleton::Consume<I_TimeGet>::by<ReportMessaging>()->getWalltime(),
            ReportIS::Type::EVENT,
            ReportIS::Level::LOG,
            ReportIS::LogLevel::INFO,
            ReportIS::Audience::INTERNAL,
            audience_team,
            severity,
            priority,
            std::chrono::seconds(0),
            std::forward<Args>(args)...
        ),
        message_type_tag(message_type)
    {
        report << LogField("eventObject", obj);
    }

    ~ReportMessaging();

    ReportMessaging & operator<<(const LogField &field);

    Maybe<void, HTTPResponse> sendReportSynchronously();

    void setForceBuffering(bool _force_buffering);

private:
    Report report;
    bool is_async_message = true;
    bool force_buffering = false;
    MessageCategory message_type_tag;
};

#endif // __REPORT_MESSAGING_H__
