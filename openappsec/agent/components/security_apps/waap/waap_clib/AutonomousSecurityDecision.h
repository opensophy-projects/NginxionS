 

#ifndef __AUTONOMOUS_SECURITY_DECISION_H__
#define __AUTONOMOUS_SECURITY_DECISION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include "WaapEnums.h"
#include <string>

class AutonomousSecurityDecision: public SingleDecision
{
public:
    explicit AutonomousSecurityDecision(DecisionType type);
    virtual ~AutonomousSecurityDecision();

    std::string getTypeStr() const override;
    void setRelativeReputation(double relativeReputation);
    void setFpMitigationScore(double fpMitigationScore);
    void setFinalScore(double finalScore);
    void setThreatLevel(ThreatLevel threatLevel);
    void setRelativeReputationMean(double relativeReputationMean);
    void setVariance(double variance);
    double getRelativeReputation() const;
    double getFpMitigationScore() const;
    double getFinalScore() const;
    ThreatLevel getThreatLevel() const;
    double getRelativeReputationMean() const;
    double getVariance() const;

private:
    double m_relativeReputation;
    double m_fpMitigationScore;
    double m_finalScore;
    ThreatLevel m_threatLevel;
    double m_relativeReputationMean;
    double m_variance;
};
#endif
