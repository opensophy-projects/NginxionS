 

#ifndef __MESSAGNIG_BUFFER_H__
#define __MESSAGNIG_BUFFER_H__

#include <map>
#include <string>

#include "i_environment.h"
#include "interfaces/i_messaging_buffer.h"
#include "singleton.h"

class MessagingBufferComponent : Singleton::Provide<I_MessageBuffer>
{
public:
    MessagingBufferComponent();
    ~MessagingBufferComponent();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MESSAGNIG_BUFFER_H__
