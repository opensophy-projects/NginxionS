 

#ifndef __CENTRAL_NGINX_MANAGER_H__
#define __CENTRAL_NGINX_MANAGER_H__

#include "component.h"
#include "singleton.h"
#include "i_messaging.h"
#include "i_rest_api.h"
#include "i_mainloop.h"
#include "i_agent_details.h"

class CentralNginxManager
        :
    public Component,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_AgentDetails>
{
public:
    CentralNginxManager();
    ~CentralNginxManager();

    void preload() override;
    void init() override;
    void fini() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __CENTRAL_NGINX_MANAGER_H__
