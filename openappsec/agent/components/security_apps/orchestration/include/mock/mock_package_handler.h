 

#ifndef __MOCK_PACKAGE_HANDLER_H__
#define __MOCK_PACKAGE_HANDLER_H__

#include "i_package_handler.h"
#include "cptest.h"

class MockPackageHandler :
    public Singleton::Provide<I_PackageHandler>::From<MockProvider<I_PackageHandler>>
{
public:
    MOCK_CONST_METHOD3(installPackage, bool(const std::string &, const std::string &, bool));
    MOCK_CONST_METHOD3(uninstallPackage, bool(const std::string &, const std::string &, const std::string &));
    MOCK_CONST_METHOD2(preInstallPackage, bool(const std::string &, const std::string &));
    MOCK_CONST_METHOD2(postInstallPackage, bool(const std::string &, const std::string &));
    MOCK_CONST_METHOD2(updateSavedPackage, bool(const std::string &, const std::string &));
    MOCK_CONST_METHOD2(shouldInstallPackage, bool(const std::string &, const std::string &));
};
#endif // __MOCK_PACKAGE_HANDLER_H__
