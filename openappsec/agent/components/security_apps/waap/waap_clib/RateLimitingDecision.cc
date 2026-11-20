 

#include "RateLimitingDecision.h"

RateLimitingDecision::RateLimitingDecision(DecisionType type) : SingleDecision(type)
{}

std::string RateLimitingDecision::getTypeStr() const
{
    return "Rate Limiting";
}
