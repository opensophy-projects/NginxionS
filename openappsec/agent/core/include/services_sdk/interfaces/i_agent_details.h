 

#ifndef __I_AGENT_DETAILS_H__
#define __I_AGENT_DETAILS_H__

#include <string>
#include <map>
#include "maybe_res.h"

enum class OrchestrationMode { ONLINE, OFFLINE, HYBRID, COUNT };

class I_AgentDetails
{
public:

    // Fog Details
    virtual void setFogPort(const uint16_t _fog_port)           = 0;
    virtual void setSSLFlag(const bool _is_over_ssl)            = 0;
    virtual void setFogDomain(const std::string &_fog_domain)   = 0;
    virtual void setProfileId(const std::string &_profile_id)   = 0;
    virtual void setTenantId(const std::string &_tenant_id)     = 0;

    virtual Maybe<uint16_t> getFogPort()                  const = 0;
    virtual bool getSSLFlag()                             const = 0;
    virtual Maybe<std::string> getFogDomain()             const = 0;
    virtual std::string getTenantId()                     const = 0;
    virtual std::string getProfileId()                    const = 0;
    virtual std::string  getRegisteredServer()            const = 0;

    // Agent Details
    virtual Maybe<std::string> getProxy()                             const = 0;
    virtual void setProxy(const std::string &_proxy)                        = 0;
    virtual void setAgentId(const std::string &_agent_id)                   = 0;
    virtual std::string getAgentId()                                  const = 0;
    virtual void setOrchestrationMode(OrchestrationMode _orchstration_mode) = 0;
    virtual void setRegisteredServer(const std::string &_server)            = 0;
    virtual OrchestrationMode getOrchestrationMode()                  const = 0;
    virtual std::string getAccessToken()                              const = 0;
    virtual void loadAccessToken()                                          = 0;
    virtual bool isOpenAppsecAgent()                                  const = 0;

    // OpenSSL
    virtual void setOpenSSLDir(const std::string &openssl_dir)  = 0;
    virtual Maybe<std::string> getOpenSSLDir()            const = 0;

    // Serialization
    virtual bool readAgentDetails()                             = 0;
    virtual bool writeAgentDetails()                            = 0;

    // Environment
    virtual void setClusterId(const std::string &_cluster_id)   = 0;

    enum class MachineType { AZURE, AWS, ON_PREM, UNRECOGNIZED };
};

#endif // __I_AGENT_DETAILS_H__
