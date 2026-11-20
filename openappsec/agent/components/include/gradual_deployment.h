 

#ifndef __GRADUAL_DEPLOYMENT_H__
#define __GRADUAL_DEPLOYMENT_H__

#include "i_gradual_deployment.h"

#include "singleton.h"
#include "i_rest_api.h"
#include "i_table.h"
#include "i_mainloop.h"
#include "component.h"

class GradualDeployment
        :
    public Component,
    Singleton::Provide<I_GradualDeployment>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_MainLoop>
{
public:
    GradualDeployment();
    ~GradualDeployment();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __GRADUAL_DEPLOYMENT_H__
