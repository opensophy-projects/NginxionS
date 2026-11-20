 

#ifndef __ERROR_LIMITING_DECISION_H__
#define __ERROR_LIMITING_DECISION_H__

#include "DecisionType.h"
#include "SingleDecision.h"
#include <string>

class ErrorLimitingDecision: public SingleDecision
{
public:
    explicit ErrorLimitingDecision(DecisionType type);
    std::string getTypeStr() const override;
};
#endif
