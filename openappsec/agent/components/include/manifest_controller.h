 

#ifndef __MANIFEST_CONTROLLER_H__
#define __MANIFEST_CONTROLLER_H__

#include "i_manifest_controller.h"

#include <set>

#include "i_orchestration_tools.h"
#include "i_package_handler.h"
#include "i_downloader.h"
#include "manifest_diff_calculator.h"
#include "manifest_handler.h"
#include "i_orchestration_status.h"
#include "i_environment.h"
#include "i_shell_cmd.h"
#include "component.h"

class ManifestController
        :
    public Component,
    Singleton::Provide<I_ManifestController>,
    Singleton::Consume<I_ShellCmd>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_PackageHandler>,
    Singleton::Consume<I_Downloader>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_OrchestrationStatus>
{
public:
    ManifestController();
    ~ManifestController();

    void init() override;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __MANIFEST_CONTROLLER_H__
