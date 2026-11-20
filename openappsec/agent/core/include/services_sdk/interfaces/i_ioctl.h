 

#ifndef __I_IOCTL_H__
#define __I_IOCTL_H__

#include "maybe_res.h"
#include "common_is/ioctl_common.h"

class I_Ioctl
{
public:
    virtual Maybe<int> sendIoctl(AgentIoctlCmdNumber request, void *ioctl_data, uint32_t size_of_data) = 0;

protected:
    virtual ~I_Ioctl() {}
};

#endif // __I_IOCTL_H__
