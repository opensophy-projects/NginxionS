 

#ifndef __ERROR_DISCLOSURE_DECISION_H__
#define __ERROR_DISCLOSURE_DECISION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include <string>

class ErrorDisclosureDecision: public SingleDecision
{
public:
    explicit ErrorDisclosureDecision(DecisionType type);
    std::string getTypeStr() const override;

};
#endif
