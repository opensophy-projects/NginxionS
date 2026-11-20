 

#include "UserLimitsDecision.h"

UserLimitsDecision::UserLimitsDecision(DecisionType type): SingleDecision(type)
{}

std::string UserLimitsDecision::getTypeStr() const
{
    return "User Limits";
}
