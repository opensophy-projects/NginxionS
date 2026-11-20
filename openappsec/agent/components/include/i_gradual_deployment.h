 

#ifndef __I_GRADUAL_DEPLOYMENT_H__
#define __I_GRADUAL_DEPLOYMENT_H__

#include <memory>
#include <vector>
#include <arpa/inet.h>

#include "maybe_res.h"
#include "c_common/ip_common.h"

class I_GradualDeployment
{
public:
    enum class AttachmentType { NGINX, KERNEL, COUNT };

    virtual Maybe<void> setPolicy(AttachmentType type, const std::vector<std::string> &str_ip_ranges) = 0;
    virtual std::vector<std::string> getPolicy(AttachmentType type) = 0;
    virtual std::vector<IPRange> & getParsedPolicy(AttachmentType type) = 0;

protected:
    virtual ~I_GradualDeployment() {}
};

#endif // __I_GRADUAL_DEPLOYMENT_H__
