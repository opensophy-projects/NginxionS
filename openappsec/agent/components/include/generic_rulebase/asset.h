 

#ifndef __ASSET_H__
#define __ASSET_H__

#include <unordered_map>

#include "i_environment.h"

class Asset
{
public:
    const std::map<Context::MetaDataType, std::string> & getAttrs() const { return attr; }
    void setAttr(Context::MetaDataType type, const std::string &attr_val) { attr[type] = attr_val; }

private:
    std::map<Context::MetaDataType, std::string> attr;
};

#endif // __ASSET_H__
