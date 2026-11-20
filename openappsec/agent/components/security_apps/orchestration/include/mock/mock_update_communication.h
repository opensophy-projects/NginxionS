 

#ifndef __MOCK_UPDATE_COMMUNICATION_H__
#define __MOCK_UPDATE_COMMUNICATION_H__

#include "i_update_communication.h"
#include "cptest.h"

std::ostream &
operator<<(std::ostream &os, const CheckUpdateRequest &)
{
    return os;
}

class MockUpdateCommunication :
    public Singleton::Provide<I_UpdateCommunication>::From<MockProvider<I_UpdateCommunication>>
{
public:
    void init() {}
    MOCK_METHOD0(authenticateAgent, Maybe<void>());
    MOCK_METHOD0(registerLocalAgentToFog, void());
    MOCK_METHOD1(getUpdate, Maybe<void>(CheckUpdateRequest &));
    MOCK_METHOD2(
        downloadAttributeFile,
        Maybe<std::string>(const GetResourceFile &, const std::string &)
    );
    MOCK_METHOD1(setAddressExtenesion, void(const std::string &));
    MOCK_CONST_METHOD2(sendPolicyVersion, Maybe<void>(const std::string &, const std::string &));
};

#endif // __MOCK_UPDATE_COMMUNICATION_H__
