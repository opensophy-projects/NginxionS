 

#ifndef __RATE_LIMITING_DECISION_H__
#define __RATE_LIMITING_DECISION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include <string>

class RateLimitingDecision: public SingleDecision
{
public:
    explicit RateLimitingDecision(DecisionType type);
    std::string getTypeStr() const override;
};
#endif
