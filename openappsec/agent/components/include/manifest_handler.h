 

#ifndef __MANIFEST_HANDLER_H__
#define __MANIFEST_HANDLER_H__

#include "package.h"
#include "i_package_handler.h"
#include "i_downloader.h"
#include "i_orchestration_tools.h"
#include "i_orchestration_status.h"
#include "i_environment.h"
#include "i_agent_details.h"
#include "i_details_resolver.h"
#include "i_time_get.h"

using packageFilePath = std::string;

class ManifestHandler
        :
    Singleton::Consume<I_MainLoop>,
    Singleton::Consume<I_AgentDetails>,
    Singleton::Consume<I_OrchestrationTools>,
    Singleton::Consume<I_PackageHandler>,
    Singleton::Consume<I_Downloader>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_OrchestrationStatus>,
    Singleton::Consume<I_DetailsResolver>
{
public:

    ManifestHandler() = default;
    void init();

    Maybe<std::vector<std::pair<Package, packageFilePath>>> downloadPackages(
        const std::map<std::string, Package> &new_packages_to_download
    );

    bool installPackage(
        const std::pair<Package, std::string> &package_downloaded_file,
        std::map<packageFilePath, Package> &current_packages,
        std::map<packageFilePath, Package> &corrupted_packages
    );

    bool uninstallPackage(Package &removed_package);

    bool selfUpdate(
        const Package &updated_package,
        std::map<packageFilePath, Package> &current_packages,
        const packageFilePath &installation_file
    );

private:
    Maybe<std::string> downloadPackage(const Package &package, bool is_clean_installation);
    std::string getCurrentTimestamp();

    std::string manifest_file_path;
    std::string temp_ext;
    std::string backup_ext;
    std::string packages_dir;
    std::string orch_service_name;
    std::string default_dir;
};
#endif // __MANIFEST_HANDLER_H__
