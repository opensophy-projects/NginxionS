 

#ifndef __I_STATIC_RESOURCES_HANDLER_H__
#define __I_STATIC_RESOURCES_HANDLER_H__

#include <memory>

#include "maybe_res.h"

class I_StaticResourcesHandler
{
public:
    virtual bool registerStaticResource(
        const std::string &resource_name,
        const std::string &resource_full_path,
        bool overwrite_if_exists = false
    ) = 0;

    virtual bool registerStaticResourceByContent(
        const std::string &resource_name,
        const std::string &file_content
    ) = 0;

protected:
    virtual ~I_StaticResourcesHandler() {}
};

#endif // __I_STATIC_RESOURCES_HANDLER_H__
