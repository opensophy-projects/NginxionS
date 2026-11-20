 

#ifndef __MESSAGING_DOWNLOADER_H__
#define __MESSAGING_DOWNLOADER_H__

#include "i_messaging_downloader.h"
#include "i_messaging.h"
#include "i_rest_api.h"
#include "i_mainloop.h"
#include "i_environment.h"
#include "component.h"

USE_DEBUG_FLAG(D_COMMUNICATION);

class MessagingDownloaderClient
        :
    public Component,
    Singleton::Provide<I_MessagingDownloader>,
    Singleton::Consume<I_RestApi>,
    Singleton::Consume<I_Messaging>,
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_Environment>
{
public:
    MessagingDownloaderClient();
    ~MessagingDownloaderClient();

    void preload() override;

    void init() override;
    void fini() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MESSAGING_DOWNLOADER_H__
