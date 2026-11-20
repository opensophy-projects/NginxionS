 

#ifndef __COMPONENT_H__
#define __COMPONENT_H__

#include <string>
#include <typeinfo>

class Component
{
public:
    Component(const std::string &component_name) : name(component_name) {}
    virtual ~Component() {}

// LCOV_EXCL_START Reason: This functions are tested in system tests
    virtual void preload() {}

    virtual void init() {}
    virtual void fini() {}
// LCOV_EXCL_STOP

    const std::string & getName() const { return name; }

private:
    std::string name;
};

#endif // __COMPONENT_H__
