 

#ifndef __MANIFEST_DIFF_CALCULATOR_H__
#define __MANIFEST_DIFF_CALCULATOR_H__

#include "package.h"
#include "i_orchestration_tools.h"

class ManifestDiffCalculator : Singleton::Consume<I_OrchestrationTools>
{
public:
    ManifestDiffCalculator() = default;

    void init();

    std::map<std::string, Package>
    filterUntrackedPackages(
        const std::map<std::string, Package> &current_packages,
        std::map<std::string, Package> &new_packages
    );

    bool
    filterCorruptedPackages(
        std::map<std::string, Package> &new_packages,
        std::map<std::string, Package> &corrupted_packages
    );

    Maybe<std::vector<Package>>
    buildInstallationQueue(
        const std::map<std::string, Package> &current_packages,
        const std::map<std::string, Package> &new_packages
    );


private:
    Maybe<void>
    buildRecInstallationQueue(
        const Package &package,
        std::vector<Package> &installation_queue,
        const std::map<std::string, Package> &current_packages,
        const std::map<std::string, Package> &new_packages
    );

    std::string corrupted_file_path;
};
#endif // __MANIFEST_DIFF_CALCULATOR_H__
