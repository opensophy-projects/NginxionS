 

#ifndef __WAAP_DECISION_H__
#define __WAAP_DECISION_H__

#include <string>
#include <memory>
#include <array>
#include <list>
#include "WaapEnums.h"
#include "SingleDecision.h"
#include "DecisionFactory.h"
#include "AutonomousSecurityDecision.h"
#include <iterator>


std::ostream& operator<<(std::ostream& os, const std::list<std::shared_ptr<SingleDecision>>& decisions);
std::ostream& operator<<(std::ostream& os, const DecisionsArr& decisions);
typedef std::list<std::shared_ptr<SingleDecision>> decision_list;

class WaapDecision {
public:
    WaapDecision();
    std::shared_ptr<SingleDecision> getDecision(DecisionType type) const;
    void orderDecisions();
    static bool
    sortDecisions(const std::shared_ptr<SingleDecision>& lhs, const std::shared_ptr<SingleDecision>& rhs);
    bool getShouldBlockFromHighestPriorityDecision() const;
    bool anyDecisionsToLogOrBlock() const;
    DecisionType getHighestPriorityDecisionToLog() const;
    void getIncidentLogFields(
        const std::string& response_status,
        std::string& incidentDetails,
        std::string& incidentType
    ) const;
    void setJson(const std::string& json);
    std::string getJson() const;

private:
    friend std::ostream& operator<<(std::ostream& os, const DecisionsArr& decisions);
    friend std::ostream& operator<<(std::ostream& os,
        const std::list<std::shared_ptr<SingleDecision>>& decisions);

    void setIteratorToFirstDecisionToLog();

    std::string m_json;
    DecisionFactory m_decisionFactory;
    decision_list m_ordered_decisions;
    decision_list::const_iterator m_first_decision_to_log;
};
#endif
