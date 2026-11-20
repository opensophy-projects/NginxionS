 

#ifndef __TUNING_DECISIONS_H__
#define __TUNING_DECISIONS_H__

#include <string>
#include <map>
#include "i_messaging.h"
#include "i_agent_details.h"
#include "waap.h"

enum TuningDecisionEnum
{
    NO_DECISION,
    DISMISS = NO_DECISION,
    BENIGN,
    MALICIOUS
};

enum TuningDecisionType
{
    UNKNOWN,
    SOURCE,
    URL,
    PARAM_NAME,
    PARAM_VALUE
};


class TuningDecision
{
public:
    TuningDecision(const std::string& remotePath);
    ~TuningDecision();

    TuningDecisionEnum getDecision(std::string tuningValue, TuningDecisionType tuningType);
private:
    void updateDecisions();
    TuningDecisionType convertDecisionType(std::string decisionTypeStr);
    TuningDecisionEnum convertDecision(std::string decisionStr);
    std::string getSharedStorageHost();

    template<typename T>
    bool sendObject(T &obj, HTTPMethod method, std::string uri)
    {
        I_Messaging *messaging = Singleton::Consume<I_Messaging>::by<WaapComponent>();
        I_AgentDetails *agentDetails = Singleton::Consume<I_AgentDetails>::by<WaapComponent>();
        if (agentDetails->getOrchestrationMode() != OrchestrationMode::ONLINE) {
            MessageMetadata req_md(getSharedStorageHost(), 80);
            // NginxionS: an agent with no cloud has no tenant; the shared storage and the tuning service refuse an empty
            // X-Tenant-Id ("Missing X-Tenant-Id"), so decisions.data of the labels of NginxionS was never read. "local" is the
            // tenant NginxionS writes with (learning/appsec.js); the path of the file does not depend on it.
            req_md.insertHeader(
                "X-Tenant-Id",
                agentDetails->getTenantId().empty() ? std::string("local") : agentDetails->getTenantId()
            );
            req_md.setConnectioFlag(MessageConnectionConfig::UNSECURE_CONN);
            req_md.setConnectioFlag(MessageConnectionConfig::ONE_TIME_CONN);
            auto req_status = messaging->sendSyncMessage(
                method,
                uri,
                obj,
                MessageCategory::GENERIC,
                req_md
            );
            return req_status.ok();
        }
        MessageMetadata req_md;
        req_md.setConnectioFlag(MessageConnectionConfig::ONE_TIME_FOG_CONN);
        auto req_status = messaging->sendSyncMessage(
            method,
            uri,
            obj,
            MessageCategory::GENERIC,
            req_md
        );
        return req_status.ok();
    }

    std::string m_remotePath;
    std::string m_baseUri;
    std::map<TuningDecisionType, std::map<std::string, TuningDecisionEnum>> m_decisions;
};

#endif
