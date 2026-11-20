 

#ifndef __HTTP_MANAGER_H__
#define __HTTP_MANAGER_H__

#include "singleton.h"
#include "i_mainloop.h"
#include "i_http_manager.h"
#include "i_rest_api.h"
#include "i_table.h"
#include "i_logging.h"
#include "component.h"

class HttpManager
        :
    public Component,
    Singleton::Provide<I_HttpManager>,
    Singleton::Consume<I_Table>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Logging>,
    Singleton::Consume<I_TimeGet>
{
public:
    HttpManager();
    ~HttpManager();

    void preload();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __HTTP_MANAGER_H__
