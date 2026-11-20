 

#ifndef __MOCK_MANIFEST_CONTROLLER_H__
#define __MOCK_MANIFEST_CONTROLLER_H__

#include "i_manifest_controller.h"
#include "cptest.h"

class MockManifestController :
    public Singleton::Provide<I_ManifestController>::From<MockProvider<I_ManifestController>>
{
public:
    MOCK_METHOD1(updateManifest, bool(const std::string &));
    MOCK_METHOD0(loadAfterSelfUpdate, bool());
};

#endif // __MOCK_MANIFEST_CONTROLLER_H__
