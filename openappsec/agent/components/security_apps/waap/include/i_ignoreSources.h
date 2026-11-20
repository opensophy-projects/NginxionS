 

#ifndef __I_IGNORE_SOURCES_H__
#define __I_IGNORE_SOURCES_H__
#include <vector>
#include <string>

class I_IgnoreSources
{
public:
    virtual std::vector<std::string>* getSourcesToIgnore() = 0;
    virtual bool ready() = 0;
};

#endif
