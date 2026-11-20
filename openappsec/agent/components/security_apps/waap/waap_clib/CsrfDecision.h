 

#ifndef __CSRF_DECISION_H__
#define __CSRF_DECISION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include <string>

class CsrfDecision: public SingleDecision
{
public:
    explicit CsrfDecision(DecisionType type);
    std::string getTypeStr() const override;
};
#endif
