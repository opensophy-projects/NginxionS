 

#ifndef __TIME_PROXY_H__
#define __TIME_PROXY_H__

#include <memory>
#include "i_time_get.h"
#include "i_time_set.h"
#include "singleton.h"
#include "component.h"

class TimeProxyComponent : public Component, Singleton::Provide<I_TimeGet>, Singleton::Provide<I_TimeSet>
{
public:
    TimeProxyComponent();
    ~TimeProxyComponent();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __TIME_PROXY_H__
