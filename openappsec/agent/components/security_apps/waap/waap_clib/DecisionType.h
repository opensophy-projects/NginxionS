 

#ifndef __DECISION_TYPE_H__
#define __DECISION_TYPE_H__

#include <ostream>

enum DecisionType
{
    // This order determines the priority of the decisions sent to management
    // Priority goes from top to bottom
    AUTONOMOUS_SECURITY_DECISION,
    CSRF_DECISION,
    OPEN_REDIRECT_DECISION,
    ERROR_DISCLOSURE_DECISION,
    ERROR_LIMITING_DECISION,
    USER_LIMITS_DECISION,
    RATE_LIMITING_DECISION,
    // Must be kept last
    NO_WAAP_DECISION
};

inline const char *
decisionTypeToString(DecisionType type)
{
    switch (type) {
        case DecisionType::AUTONOMOUS_SECURITY_DECISION:
            return "AUTONOMOUS_SECURITY_DECISION";
        case DecisionType::CSRF_DECISION:
            return "CSRF_DECISION";
        case DecisionType::OPEN_REDIRECT_DECISION:
            return "OPEN_REDIRECT_DECISION";
        case DecisionType::ERROR_DISCLOSURE_DECISION:
            return "ERROR_DISCLOSURE_DECISION";
        case DecisionType::ERROR_LIMITING_DECISION:
            return "ERROR_LIMITING_DECISION";
        case DecisionType::USER_LIMITS_DECISION:
            return "USER_LIMITS_DECISION";
        case DecisionType::RATE_LIMITING_DECISION:
            return "RATE_LIMITING_DECISION";
        case DecisionType::NO_WAAP_DECISION:
            return "NO_WAAP_DECISION";
        default:
            return "INVALID_DECISION_TYPE";
    }
}

inline std::ostream & operator<<(std::ostream& os, const DecisionType& type)
{
    return os << decisionTypeToString(type);
}

#endif
