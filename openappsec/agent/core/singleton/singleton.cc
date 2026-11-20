 

#include "singleton.h"
#include "debug.h"

void
Singleton::registerSingleton(std::type_index type, void *ptr)
{
    singles[type].insert(ptr);
}

void
Singleton::unregisterSingleton(std::type_index type, void *ptr)
{
    singles[type].erase(ptr);
}

void *
Singleton::get(const std::type_index &type)
{
    dbgAssert(singles[type].size() == 1)
        << AlertInfo(AlertTeam::CORE, "singleton i/s")
        << "There is no single element from type '"
        << type.name()
        << "', number of elements is "
        << singles[type].size();

    return *(singles[type].begin());
}

bool
Singleton::exists(const std::type_index &type)
{
    return singles[type].size() != 0;
}

std::map<std::type_index, std::set<void *>> Singleton::singles;
std::map<std::type_index, std::unique_ptr<Singleton::OwnedSingleton>> Singleton::owned_singles;
