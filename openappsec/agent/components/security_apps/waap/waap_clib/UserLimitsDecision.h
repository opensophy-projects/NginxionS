 

#ifndef __USER_LIMITS_DECISION_H__
#define __USER_LIMITS_DECISION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include <string>

class UserLimitsDecision: public SingleDecision
{
public:
    explicit UserLimitsDecision(DecisionType type);
    std::string getTypeStr() const override;
};
#endif
