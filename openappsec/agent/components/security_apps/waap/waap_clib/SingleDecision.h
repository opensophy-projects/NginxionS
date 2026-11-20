 

#ifndef __SINGLE_DECISION_H__
#define __SINGLE_DECISION_H__

#include "DecisionType.h"
#include <string>

class SingleDecision
{
public:
    explicit SingleDecision(DecisionType type);
    virtual ~SingleDecision();

    void setLog(bool log);
    void setBlock(bool block);
    void setForceLog(bool overridesLog);
    void setForceAllow(bool allow);
    void setForceBlock(bool block);
    DecisionType getType() const;
    bool shouldLog() const;
    bool shouldBlock() const;
    bool shouldForceLog() const;
    bool shouldForceAllow() const;
    bool shouldForceBlock() const;
    virtual std::string getTypeStr() const = 0;

protected:
    DecisionType m_type;
    bool m_log;
    bool m_block;
    bool m_ForceLog;
    bool m_forceAllow;
    bool m_forceBlock;
};

#endif
