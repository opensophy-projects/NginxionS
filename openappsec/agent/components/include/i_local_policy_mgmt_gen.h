 

#ifndef __I_LOCAL_POLICY_MGMT_GEN_H__
#define __I_LOCAL_POLICY_MGMT_GEN_H__

#include "i_env_details.h"

class I_LocalPolicyMgmtGen
{
public:
    virtual std::string generateAppSecLocalPolicy(
        EnvType env_type,
        const std::string &policy_version,
        const std::string &local_policy_path) = 0;

protected:
    ~I_LocalPolicyMgmtGen() {}
};

#endif //__I_LOCAL_POLICY_MGMT_GEN_H__
