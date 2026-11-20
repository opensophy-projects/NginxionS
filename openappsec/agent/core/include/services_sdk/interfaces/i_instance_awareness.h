 

#ifndef __I_INSTANCE_AWARENESS_H__
#define __I_INSTANCE_AWARENESS_H__

#include <string>

#include "maybe_res.h"

class I_InstanceAwareness
{
public:
    virtual Maybe<std::string> getUniqueID() = 0;
    virtual Maybe<std::string> getFamilyID() = 0;
    virtual Maybe<std::string> getInstanceID() = 0;

    virtual std::string getUniqueID(const std::string &defaul_value) = 0;
    virtual std::string getFamilyID(const std::string &defaul_value) = 0;
    virtual std::string getInstanceID(const std::string &defaul_value) = 0;
};

#endif // __I_INSTANCE_AWARENESS_H__
