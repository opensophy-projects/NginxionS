 

#ifndef __HYBRID_COMMUNICATION_H__
#define __HYBRID_COMMUNICATION_H__

#include <chrono>
#include <functional>
#include <tuple>
#include <vector>
#include "cereal/archives/json.hpp"

#include "singleton.h"
#include "i_update_communication.h"
#include "fog_authenticator.h"
#include "i_local_policy_mgmt_gen.h"
#include "i_orchestration_tools.h"
#include "i_agent_details.h"
#include "i_orchestration_status.h"
#include "i_messaging.h"
#include "i_mainloop.h"
#include "i_encryptor.h"
#include "i_details_resolver.h"
#include "i_rest_api.h"
#include "i_time_get.h"
#include "i_encryptor.h"
#include "maybe_res.h"
#include "declarative_policy_utils.h"

class HybridCommunication : public FogAuthenticator
{
public:
    void init() override;
    // NginxionS: the agent of NginxionS has no cloud and never registers at a Fog
    Maybe<void> authenticateAgent() override;
    Maybe<void> getUpdate(CheckUpdateRequest &request) override;
    Maybe<std::string> downloadAttributeFile(
        const GetResourceFile &resourse_file,
        const std::string &file_path
    ) override;
    Maybe<void> sendPolicyVersion(
        const std::string &policy_version,
        const std::string &policy_versions
    ) const override;

private:
    Maybe<std::string> getNewVersion();
    void doLocalFogOperations(const std::string &policy) const;

    std::string tuning_host;
    I_DeclarativePolicy *i_declarative_policy = nullptr;
};

#endif // __HYBRID_COMMUNICATION_H__
