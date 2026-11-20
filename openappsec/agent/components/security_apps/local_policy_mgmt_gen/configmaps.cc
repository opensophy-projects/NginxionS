 

#include "configmaps.h"

using namespace std;

USE_DEBUG_FLAG(D_LOCAL_POLICY);

// LCOV_EXCL_START Reason: no test exist
bool
ConfigMaps::loadJson(const std::string &json)
{
    string modified_json = json;
    modified_json.pop_back();
    stringstream in;
    in.str(modified_json);
    dbgTrace(D_LOCAL_POLICY) << "Loading ConfigMaps data";
    try {
        cereal::JSONInputArchive in_ar(in);
        in_ar(
            cereal::make_nvp("data", data)
        );
    } catch (cereal::Exception &e) {
        dbgError(D_LOCAL_POLICY) << "Failed to load ConfigMaps JSON. Error: " << e.what();
        return false;
    }
    return true;
}

string
ConfigMaps::getFileContent() const
{
    if (data.size()) {
        return data.begin()->second;
    }
    return string();
}

string
ConfigMaps::getFileName() const
{
    if (data.size()) {
        return data.begin()->first;
    }
    return string();
}
// LCOV_EXCL_STOP
