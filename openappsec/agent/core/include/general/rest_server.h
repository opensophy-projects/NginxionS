 

#ifndef __REST_SERVER__
#define __REST_SERVER__

#include <memory>

#include "i_rest_api.h"
#include "i_mainloop.h"
#include "singleton.h"
#include "i_environment.h"
#include "component.h"

class RestServer
        :
    public Component,
    Singleton::Provide<I_RestApi>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Environment>
{
public:
    RestServer();
    ~RestServer();

    void preload();

    void init();
    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __REST_SERVER__
