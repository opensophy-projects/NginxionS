 

#ifndef __IOCTL_IS_H__
#define __IOCTL_IS_H__

#include <memory>

#include "singleton.h"
#include "i_ioctl.h"
#include "i_mainloop.h"
#include "i_shell_cmd.h"
#include "component.h"

class IoctlIS
        :
    public Component,
    Singleton::Provide<I_Ioctl>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_ShellCmd>
{
public:
    IoctlIS();
    ~IoctlIS();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __IOCTL_IS_H__
