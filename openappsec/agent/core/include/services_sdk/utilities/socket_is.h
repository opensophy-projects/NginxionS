 

#ifndef __SOCKET_IS_H__
#define __SOCKET_IS_H__

#include "i_socket_is.h"
#include "i_mainloop.h"
#include "singleton.h"
#include "component.h"
#include "i_time_get.h"

class SocketIS
        :
    public Component,
    Singleton::Provide<I_Socket>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_TimeGet>
{
public:
    SocketIS();
    ~SocketIS();

    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __SOCKET_IS_H__
