 

#ifndef __SHELL_CMD_H__
#define __SHELL_CMD_H__

#include "i_shell_cmd.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "singleton.h"
#include "component.h"

class ShellCmd
        :
    public Component,
    Singleton::Provide<I_ShellCmd>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_TimeGet>
{
public:
    ShellCmd();
    ~ShellCmd();

    void preload() override;
    void init() override;
    void fini() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __SHELL_CMD_H__
