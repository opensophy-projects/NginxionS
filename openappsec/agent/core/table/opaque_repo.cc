 

#include "table/opaque_repo.h"

void
TableOpaqueRep::addType(const std::string &name, const Gen &gen, const uint &curr, const uint &min)
{
    GenRep[name] = gen;
    GenMinVer[name] = min;
    GenCurrVer[name] = curr;
}

std::unique_ptr<TableOpaqueBase>
TableOpaqueRep::getOpaqueByName(const std::string &name)
{
    auto iter = GenRep.find(name);
    if (iter == GenRep.end()) return nullptr;
    return (iter->second)();
}
