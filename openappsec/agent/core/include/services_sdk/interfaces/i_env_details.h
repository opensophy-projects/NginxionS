 

#ifndef __I_ENV_DETAILS_H__
#define __I_ENV_DETAILS_H__

#include <string>
#include <stdbool.h>

enum class EnvType { LINUX, DOCKER, K8S, NON_CRD_K8S, COUNT };

class I_EnvDetails
{
public:
    virtual EnvType getEnvType() = 0;
    virtual std::string getToken() = 0;
    virtual std::string getNameSpace() = 0;

protected:
    virtual ~I_EnvDetails() {}
};

#endif // __I_ENV_DETAILS_H__
