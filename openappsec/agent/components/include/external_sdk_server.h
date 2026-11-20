 

#ifndef __EXTERNAL_SDK_SERVER_H__
#define __EXTERNAL_SDK_SERVER_H__

#include <memory>

#include "i_external_sdk_server.h"
#include "i_rest_api.h"
#include "component.h"

class ExternalSdkServer
        :
    public Component,
    Singleton::Provide<I_ExternalSdkServer>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_Messaging>
{
public:
    ExternalSdkServer();
    ~ExternalSdkServer();

    void init();
    void fini();

    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __EXTERNAL_SDK_SERVER_H__
