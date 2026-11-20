 

#ifndef __LOCAL_COMMUNICATION_H__
#define __LOCAL_COMMUNICATION_H__

#include "i_update_communication.h"
#include "i_orchestration_tools.h"
#include "maybe_res.h"

class LocalCommunication
        :
    public I_UpdateCommunication,
    Singleton::Consume<I_OrchestrationTools>
{
public:
    static void preload();

    void init();

    Maybe<void> authenticateAgent() override;
    void registerLocalAgentToFog() override;
    Maybe<void> getUpdate(CheckUpdateRequest &request) override;

    Maybe<std::string> downloadAttributeFile(
        const GetResourceFile &resourse_file,
        const std::string &file_path
    ) override;
    void setAddressExtenesion(const std::string &extension) override;
    Maybe<void> sendPolicyVersion(
        const std::string &policy_version,
        const std::string &policy_versions
    ) const override;

private:
    std::string getChecksum(const std::string &file_path);
    std::string filesystem_prefix = "";
};

#endif // __LOCAL_COMMUNICATION_H__
