 

#ifndef __CONNECTION_COMPONENT_H__
#define __CONNECTION_COMPONENT_H__

#include <map>
#include <string>

#include "i_agent_details.h"
#include "i_encryptor.h"
#include "i_environment.h"
#include "i_mainloop.h"
#include "i_messaging.h"
#include "i_time_get.h"
#include "interfaces/i_messaging_connection.h"

#include "maybe_res.h"

class ConnectionComponent : Singleton::Provide<I_MessagingConnection>
{
public:
    ConnectionComponent();
    ~ConnectionComponent();
    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __CONNECTION_COMPONENT_H__
