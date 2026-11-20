 

#ifndef __TAG_AND_ENUM_MANAGEMENT_H__
#define __TAG_AND_ENUM_MANAGEMENT_H__

#include <string>
#include <set>

#include "enum_array.h"
#include "report/report_enums.h"

class TagAndEnumManagement
{
public:
    static void                         print(ReportIS::Tags tag, std::ostream& os);
    static std::set<std::string>        convertToString(const std::set<ReportIS::Tags> &tags);
    static std::string                  convertToString(const ReportIS::AudienceTeam   &team);
    static std::string                  convertToString(const ReportIS::Severity       &severity);
    static std::string                  convertToString(const ReportIS::Type           &type);
    static std::string                  convertToString(const ReportIS::Level          &level);
    static std::string                  convertToString(const ReportIS::LogLevel       &log_level);
    static std::string                  convertToString(const ReportIS::Audience       &audience);
    static std::string                  convertToString(const ReportIS::Priority       &priority);
    static std::string                  convertToString(const ReportIS::StreamType     &stream_type);
    static std::string                  convertToString(const ReportIS::Notification   &notification);
    static std::string                  convertToString(const ReportIS::IssuingEngine  &issuing_engine);
    static Maybe<ReportIS::Severity>    convertStringToSeverity(const std::string &severity);
    static Maybe<ReportIS::Priority>    convertStringToPriority(const std::string &priority);
    static Maybe<ReportIS::Audience>    convertStringToAudience(const std::string &audience);
    static Maybe<ReportIS::Level>       convertStringToLevel(const std::string &level);
    static Maybe<ReportIS::LogLevel>    convertStringToLogLevel(const std::string &log_level);
    static Maybe<ReportIS::Tags>        convertStringToTag(const std::string &tag);

private:
    static EnumArray<ReportIS::Tags, std::string> tags_translation_arr;
    static EnumArray<ReportIS::AudienceTeam, std::string>  audience_team_translation;
};

#endif // __TAG_AND_ENUM_MANAGEMENT_H__
