 

#include "WaapTrigger.h"
#include "Waf2Util.h"

namespace Waap {
namespace Trigger {

Log::Log()
:
    verbosity("standard"),
    complianceWarnings(true),
    complianceViolations(true),
    acAllow(true),
    acDrop(true),
    tpDetect(true),
    tpPrevent(true),
    webRequests(true),
    webUrlPath(true),
    webUrlQuery(true),
    webHeaders(false),
    webBody(true),
    logToCloud(true),
    logToAgent(true),
    extendLogging(false),
    responseCode(false),
    responseBody(false),
    extendLoggingMinSeverity("")
{
}

bool
Log::operator==(const Log &other) const
{
    return (verbosity == other.verbosity) &&
        (complianceWarnings == other.complianceWarnings) &&
        (complianceViolations == other.complianceViolations) &&
        (acAllow == other.acAllow) &&
        (acDrop == other.acDrop) &&
        (tpDetect == other.tpDetect) &&
        (tpPrevent == other.tpPrevent) &&
        (webRequests == other.webRequests) &&
        (webUrlPath == other.webUrlPath) &&
        (webHeaders == other.webHeaders) &&
        (webUrlQuery == other.webUrlQuery) &&
        (webBody == other.webBody) &&
        (logToCloud == other.logToCloud) &&
        (logToAgent == other.logToAgent);
}

Trigger::Trigger():triggerType("log"), log(std::make_shared<Log>())
{
}

bool
Trigger::operator==(const Trigger &other) const
{
    return  (triggerType == other.triggerType) &&
            (Waap::Util::compareObjects(log, other.log));
}

bool Policy::operator==(const Policy &other) const
{
    return triggers == other.triggers;
}

bool TriggersByPractice::operator==(const TriggersByPractice &other) const
{
    return m_web_app_ids == other.m_web_app_ids &&
        m_api_protect_ids == other.m_api_protect_ids &&
        m_anti_bot_ids == other.m_anti_bot_ids;
}

const std::vector<std::string>& TriggersByPractice::getTriggersByPractice(DecisionType practiceType) const
{
    switch (practiceType)
    {
    case DecisionType::AUTONOMOUS_SECURITY_DECISION:
        return m_web_app_ids;
    default:
        dbgDebug(D_WAAP) <<
        "Can't find practice type for triggers by practice: " <<
        practiceType <<
        ", return web app triggers";
        return m_web_app_ids;
    }
}

const std::vector<std::string>& TriggersByPractice::getAllTriggers() const
{
    return m_all_ids;
}

bool WebUserResponseByPractice::operator==(const WebUserResponseByPractice &other) const
{
    return m_web_app_ids == other.m_web_app_ids &&
        m_api_protect_ids == other.m_api_protect_ids &&
        m_anti_bot_ids == other.m_anti_bot_ids;
}

const std::vector<std::string>& WebUserResponseByPractice::getResponseByPractice(DecisionType practiceType) const
{
    switch (practiceType)
    {
    case DecisionType::AUTONOMOUS_SECURITY_DECISION:
        return m_web_app_ids;
    default:
        dbgDebug(D_WAAP)
            << "Can't find practice type for triggers by practice: "
            << practiceType
            << ", return web app triggers";
        return m_web_app_ids;
    }
}
}
}
