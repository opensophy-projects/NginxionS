 

#ifndef __TRAP_HANDLER_H__
#define __TRAP_HANDLER_H__

#include <memory>

#include "singleton.h"
#include "i_trap_handler.h"
#include "i_ioctl.h"
#include "i_mainloop.h"
#include "component.h"

class TrapHandler
        :
    public Component,
    Singleton::Provide<I_TrapHandler>,
    Singleton::Consume<I_Ioctl>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_TrapHandler>
{
public:
    TrapHandler();
    ~TrapHandler();

    void init();
    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __TRAP_HANDLER_H__
