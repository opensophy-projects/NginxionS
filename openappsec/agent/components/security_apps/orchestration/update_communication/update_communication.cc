 

#include "update_communication.h"

#include <algorithm>
#include <map>
#include <vector>

#include "rest.h"
#include "config.h"
#include "log_generator.h"
#include "agent_details.h"
#include "version.h"
#include "i_encryptor.h"
#include "fog_authenticator.h"
#include "fog_communication.h"
#include "service_controller.h"
#include "local_communication.h"
#include "hybrid_communication.h"

using namespace std;

USE_DEBUG_FLAG(D_ORCHESTRATOR);

class UpdateCommunication::Impl
        :
    public ServerRest,
    Singleton::Provide<I_UpdateCommunication>::From<UpdateCommunication>
{
public:
    void
    doCall() override
    {
        Singleton::Consume<I_ServiceController>::by<UpdateCommunication>()->refreshPendingServices();
        Singleton::Consume<I_MainLoop>::by<UpdateCommunication>()->stopAll();
        status = "Operation mode had changed successfully";
    }

    void
    preload()
    {
        registerExpectedSetting<string>("profileManagedMode");
        FogAuthenticator::preload();
        LocalCommunication::preload();
    }

    void
    init()
    {
        declarative_policy_utils.init();
        auto rest = Singleton::Consume<I_RestApi>::by<UpdateCommunication>();
        rest->addRestCall<UpdateCommunication::Impl>(RestAction::SET, "orchestration-mode");
        setMode();
    }

    Maybe<void>
    authenticateAgent()
    {
        return i_update_comm_impl->authenticateAgent();
    }

    void registerLocalAgentToFog()
    {
        i_update_comm_impl->registerLocalAgentToFog();
    }

    Maybe<void>
    getUpdate(CheckUpdateRequest &request) override
    {
        return i_update_comm_impl->getUpdate(request);
    }

    Maybe<void>
    sendPolicyVersion(const string &policy_version, const string &policy_versions) const override
    {
        return i_update_comm_impl->sendPolicyVersion(policy_version, policy_versions);
    }

    Maybe<string>
    downloadAttributeFile(const GetResourceFile &resourse_file, const string &file_path) override
    {
        return i_update_comm_impl->downloadAttributeFile(resourse_file, file_path);
    }

    void
    setAddressExtenesion(const string &extension) override
    {
        i_update_comm_impl->setAddressExtenesion(extension);
    }

    void
    fini()
    {
        i_update_comm_impl = nullptr;
    }

private:
    void
    setMode()
    {
        if (getConfigurationFlag("orchestration-mode") == "offline_mode") {
            i_update_comm_impl = make_unique<LocalCommunication>();
        } else if (getConfigurationFlag("orchestration-mode") == "hybrid_mode") {
            i_update_comm_impl = make_unique<HybridCommunication>();
        } else {
            i_update_comm_impl = make_unique<FogCommunication>();
        }

        i_update_comm_impl->init();
    }

    std::unique_ptr<I_UpdateCommunication> i_update_comm_impl = nullptr;
    DeclarativePolicyUtils declarative_policy_utils;
    S2C_LABEL_PARAM(string, status, "status");
};

UpdateCommunication::UpdateCommunication() : Component("UpdateCommunication"), pimpl(make_unique<Impl>()) {}

UpdateCommunication::~UpdateCommunication() {}

void
UpdateCommunication::preload()
{
    pimpl->preload();
}

void
UpdateCommunication::init()
{
    pimpl->init();
}

void
UpdateCommunication::fini()
{
    pimpl->fini();
}
