 

#ifndef __I_PACKAGE_HANDLER_H__
#define __I_PACKAGE_HANDLER_H__

#include <string>

class I_PackageHandler
{
public:
    virtual bool shouldInstallPackage(const std::string &package_name, const std::string &install_file_path) const = 0;

    virtual bool installPackage(
        const std::string &package_name,
        const std::string &install_file_path,
        bool restore_mode
    ) const = 0;
    virtual bool uninstallPackage(
        const std::string &package_name,
        const std::string &package_path,
        const std::string &install_file_path
    ) const = 0;
    virtual bool preInstallPackage(
        const std::string &package_name,
        const std::string &install_file_path
    ) const = 0;
    virtual bool postInstallPackage(
        const std::string &package_name,
        const std::string &install_file_path
    ) const = 0;
    virtual bool updateSavedPackage(
        const std::string &package_name,
        const std::string &install_file_path
    ) const = 0;
};
#endif // __I_PACKAGE_HANDLER_H__
