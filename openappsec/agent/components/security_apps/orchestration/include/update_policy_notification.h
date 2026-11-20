 

#ifndef __UPDATE_POLICY_NOTIFICATION__H__
#define __UPDATE_POLICY_NOTIFICATION__H__

#include <string>
#include <ostream>
#include "rest.h"

class UpdatePolicyCrdObject : public ClientRest
{
public:
    UpdatePolicyCrdObject(const std::string &_policy_version) : policy_version(_policy_version) {}

private:
    C2S_LABEL_PARAM(std::string, policy_version, "policyVersion");
};

#endif //__UPDATE_POLICY_NOTIFICATION__H__
