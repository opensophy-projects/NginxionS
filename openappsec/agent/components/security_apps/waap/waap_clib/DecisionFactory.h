 

#ifndef __DECISION_FACTORY_H__
#define __DECISION_FACTORY_H__

#include "DecisionType.h"
#include "SingleDecision.h"
#include <array>
#include <memory>

typedef std::array<std::shared_ptr<SingleDecision>, NO_WAAP_DECISION> DecisionsArr;

class DecisionFactory
{
public:
    DecisionFactory();
    std::shared_ptr<SingleDecision> getDecision(DecisionType type) const;
    const DecisionsArr& getDecisions() const
    {
        return m_decisions;
    }

private:
    void initDecision(DecisionType type);
    void initAutonomousSecurityDecision();
    void initCsrfDecision();
    void initOpenRedirectDecision();
    void initErrorDisclosureDecision();
    void initErrorLimitingDecision();
    void initRateLimitingDecision();
    void initUserLimitsDecision();
    DecisionsArr m_decisions;
};
#endif
