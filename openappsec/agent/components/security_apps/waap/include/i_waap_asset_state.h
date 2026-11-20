 

#pragma once

#include "WaapEnums.h"

class I_WaapAssetState {
public:
    virtual void updateScores() = 0;
    virtual std::string getWaapDataFileName() const = 0;
    virtual std::string getWaapDataDir() const = 0;
    virtual bool isKeywordOfType(const std::string& keyword, ParamType type) const = 0;
    virtual bool isBinarySampleType(const std::string & sample) const = 0;
    virtual bool isWBXMLSampleType(const std::string & sample) const = 0;
    virtual std::set<std::string> getSampleType(const std::string& sample) const = 0;
};
