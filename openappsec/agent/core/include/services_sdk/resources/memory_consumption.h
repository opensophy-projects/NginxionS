 

#ifndef __MEMORY_CONSUMPTION_H__
#define __MEMORY_CONSUMPTION_H__

#include "i_mainloop.h"
#include "i_environment.h"
#include "debug.h"
#include "common.h"
#include "component.h"

class MemoryCalculator
        :
    public Component,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Environment>
{
public:
    MemoryCalculator();
    ~MemoryCalculator();

    void preload();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MEMORY_CONSUMPTION_H__
