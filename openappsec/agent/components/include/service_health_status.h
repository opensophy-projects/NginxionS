 

#ifndef __SERVICE_HEALTH_STATUS_H__
#define __SERVICE_HEALTH_STATUS_H__

#include "singleton.h"
#include "i_rest_api.h"
#include "i_environment.h"
#include "component.h"

class ServiceHealthStatus
        :
    public Component,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_Environment>
{
public:
    ServiceHealthStatus();
    ~ServiceHealthStatus();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __SERVICE_HEALTH_STATUS_H__
