 

#ifndef __I_MANIFEST_CONTROLLER_H__
#define __I_MANIFEST_CONTROLLER_H__

#include <string>

class I_ManifestController
{
public:
    virtual bool updateManifest(const std::string &new_manifest_file) = 0;
    virtual bool loadAfterSelfUpdate() = 0;
};

#endif // __I_MANIFEST_CONTROLLER_H__
