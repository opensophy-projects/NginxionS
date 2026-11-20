 

#include "ErrorLimitingDecision.h"

ErrorLimitingDecision::ErrorLimitingDecision(DecisionType type): SingleDecision(type)
{}

std::string  ErrorLimitingDecision::getTypeStr() const
{
    return "Error Limiting";
}
