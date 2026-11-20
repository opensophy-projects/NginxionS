 

#ifndef __ATTACHMENT_REGISTRATOR_H__
#define __ATTACHMENT_REGISTRATOR_H__

#include "singleton.h"
#include "i_mainloop.h"
#include "i_shell_cmd.h"
#include "i_socket_is.h"
#include "attachment_types.h"
#include "component.h"

#define default_keep_alive_path "/etc/cp/attachmentRegistrator/expiration-socket"

class AttachmentRegistrator
        :
    public Component,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_Socket>
{
public:
    AttachmentRegistrator();
    ~AttachmentRegistrator();

    void preload();

    void init();
    void fini();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __ATTACHMENT_REGISTRATOR_H__
