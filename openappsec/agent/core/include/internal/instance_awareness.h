 

#ifndef __INSTANCE_AWARENESS_H__
#define __INSTANCE_AWARENESS_H__

#include <string>
#include <memory>

#include "singleton.h"
#include "i_instance_awareness.h"
#include "component.h"

class InstanceAwareness : public Component, public Singleton::Provide<I_InstanceAwareness>
{
public:
    InstanceAwareness();
    ~InstanceAwareness();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __INSTANCE_AWARENESS_H__
